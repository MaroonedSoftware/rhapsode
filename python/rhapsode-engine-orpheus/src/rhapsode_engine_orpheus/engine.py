"""Orpheus as a rhapsode engine. protocol.md § 8."""

from __future__ import annotations

import importlib.util
import os
from collections.abc import Iterator
from typing import Any, ClassVar

from rhapsode_worker import Engine, NativeFormat, SpeakRequest, UnknownVoice, Unsupported, Variant, Voice
from rhapsode_worker.engine import Device

from .backends import LlamaCppSource, Sampling, TokenSource, VllmSource
from .builds import (
    DEFAULT_VOICE,
    FULL_FILES,
    FULL_REPOSITORY,
    FULL_REVISION,
    GGUF_FILES,
    GGUF_REPOSITORY,
    GGUF_REVISION,
    SNAC_REPOSITORY,
    SNAC_REVISION,
    VOICES,
    variants,
)
from .codes import Framer
from .decoder import SnacDecoder
from .prompt import MAX_TOKENS, prompt, segments, translate_cues

#: SNAC 24 kHz, mono.
SAMPLE_RATE = 24_000

#: What the `full` build asks vLLM for, when the operator has not said. The weights are 7.6 GB in
#: bfloat16, half the 15.2 GB of float32 on disk; the rest is vLLM's activations, its CUDA graphs and
#: a KV cache for one 2048-token sequence. Not measured on a card yet: `RHAPSODE_ORPHEUS_GPU_MEMORY`,
#: a fraction of the card, overrides it, and the first CUDA run is where to put a number here.
FULL_MEMORY_BYTES = 10 * 2**30

#: vLLM's own default, and the most this engine will ask for however small the card.
MOST_OF_A_CARD = 0.9


def _installed(distribution: str) -> str | None:
    try:
        from importlib.metadata import version

        return version(distribution)
    except Exception:
        return None


class OrpheusEngine(Engine):
    id = "orpheus"
    display_name = "Orpheus"

    # Canopy publishes the finetune as Apache-2.0. It is a finetune of Llama 3.2 3B Instruct, and
    # whether Meta's community licence also reaches it is a question the notes raise rather than a
    # field this document can answer; its terms permit commercial use either way.
    license: ClassVar[dict[str, Any]] = {
        "code": "Apache-2.0",
        "weights": "Apache-2.0",
        "weights_commercial_use": True,
        "notes": "https://huggingface.co/canopylabs/orpheus-3b-0.1-ft, a finetune of Llama 3.2 3B",
    }

    native_format = NativeFormat(encoding="pcm_s16le", sample_rate=SAMPLE_RATE, channels=1)
    default_variant = "q8"

    #: One model, one utterance at a time. llama.cpp decodes one sequence per context.
    concurrency = 1

    max_characters = 4096
    upstream_version = _installed("llama-cpp-python")

    _source: TokenSource | None = None
    _decoder: SnacDecoder | None = None

    # ------------------------------------------------------------------ what this engine can do

    def variants(self) -> dict[str, Variant]:
        return variants(full=self._can_run_full())

    def _can_run_full(self) -> bool:
        """A CUDA card and vLLM, which is Linux on NVIDIA only. `find_spec` rather than an import,
        because importing vLLM takes seconds and this is asked on every `/capabilities`."""
        return self.device.type == "cuda" and importlib.util.find_spec("vllm") is not None

    # ------------------------------------------------------------------ residency

    def load(self, variant: str) -> None:
        self._check(variant)
        if variant == "full":
            self._source = VllmSource(_full(), memory_fraction=memory_fraction(self.device))
        else:
            accelerated = self.device.type in {"cuda", "rocm", "mps"}
            self._source = LlamaCppSource(_gguf(variant), gpu=accelerated)
        self._decoder = SnacDecoder(_torch_device(self.device))

    def fetch(self, variant: str) -> None:
        """Download a build's GGUF and the codec into the Hugging Face cache, where its load will look.

        The same files at the same revisions `load` asks for, so the load that follows is a cache hit.
        `q8` is 3.5 GB, which a first `/speak` would otherwise spend its whole budget downloading.
        """
        self._check(variant)
        if variant == "full":
            _full()
        else:
            _gguf(variant)
        _snac()

    def _check(self, variant: str) -> None:
        declared = self.variants()
        if variant in declared:
            return
        if variant == "full":
            raise Unsupported(
                'the "full" build runs on vLLM, which needs a CUDA card and '
                "`pip install 'rhapsode-engine-orpheus[vllm]'` in this engine's virtualenv"
            )
        raise Unsupported(f'no build "{variant}"; this engine has {sorted(declared)}')

    def unload(self) -> None:
        """Close the Llama, drop the codec, and ask torch for the memory back.

        llama.cpp frees its own buffers on close. The codec is torch's, and torch keeps what it freed
        cached until asked.
        """
        source, self._source, self._decoder = self._source, None, None
        if source is not None:
            source.close()
        try:
            import torch

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            elif torch.backends.mps.is_available():
                torch.mps.empty_cache()
        except Exception:
            pass

    # ------------------------------------------------------------------ voices

    def voices(self) -> list[Voice]:
        """The finetune's eight. A voice here is a name the model was trained on, and not a file."""
        variant = self.variant or self.default_variant
        return [
            Voice(
                id=name,
                label=name.title(),
                description="One of the finetune's own voices",
                # The build is in it because q8 and q4 are the same voice at two precisions, and a
                # quantisation is exactly the kind of change a cached preview should not outlive.
                spec=f"{name}@{variant}",
                tags=("preset", "en"),
            )
            for name in VOICES
        ]

    # ------------------------------------------------------------------ speaking

    def speak(self, request: SpeakRequest) -> Iterator[bytes]:
        """Generate, frame, decode and yield as each frame is ready. The first engine here that streams.

        Long text is several generations in a row, one per segment, because one generation holds at
        most 14.6 s. Each segment's seed is the request's plus its index, so the whole request
        reproduces and no two segments are sampled alike.
        """
        source, decoder = self._source, self._decoder
        if source is None or decoder is None:
            raise Unsupported("no model is loaded")

        voice = request.voice or DEFAULT_VOICE
        if voice not in VOICES:
            raise UnknownVoice(f'no voice "{voice}"; this engine has {", ".join(VOICES)}')

        dials = self.dials_for(request)
        for index, segment in enumerate(segments(translate_cues(request.text))):
            sampling = Sampling(
                temperature=dials["temperature"],
                top_p=dials["topP"],
                repetition_penalty=dials["repetitionPenalty"],
                seed=None if request.seed is None else request.seed + index,
            )
            framer = Framer()
            generated = 0
            for token in source.tokens(prompt(voice, segment), sampling):
                generated += 1
                window = framer.push(token)
                if window is not None:
                    yield decoder.decode(window)
            tail = framer.finish()
            if tail is not None:
                yield decoder.decode(tail)

            if generated >= MAX_TOKENS:
                # The model was still speaking when it ran out, so this segment ends mid-word. It is
                # what SEGMENT_CHARACTERS exists to prevent, and the evidence for tuning it.
                self.log.warn("a segment ran out of tokens", characters=len(segment), tokens=generated)


def _gguf(variant: str) -> str:
    """The build's GGUF, from the Hugging Face cache, downloading it if it is not there yet."""
    return _download(GGUF_REPOSITORY, GGUF_FILES[variant], GGUF_REVISION)


def _full() -> str:
    """Canopy's finetune, file by file, and the directory vLLM should load it from.

    Gated, so a box with no token, or a token whose account has not accepted the terms, is refused
    by the hub. That is a fact about this box's configuration, and `unsupported` with the fix in it
    serves the operator better than the hub's 401 surfacing as `internal`.
    """
    from huggingface_hub.errors import GatedRepoError

    try:
        paths = [_download(FULL_REPOSITORY, filename, FULL_REVISION) for filename in FULL_FILES]
    except GatedRepoError as error:
        raise Unsupported(
            f"{FULL_REPOSITORY} is gated: accept its terms at https://huggingface.co/{FULL_REPOSITORY} "
            'and give this engine the token, as "env": { "HF_TOKEN": "..." } on its entry in '
            "rhapsode.config.json"
        ) from error
    return os.path.dirname(paths[0])


def _torch_device(device: Device) -> str:
    """torch's name for the detected device. ROCm builds of torch answer to "cuda"."""
    return {"cuda": "cuda", "rocm": "cuda", "mps": "mps"}.get(device.type, "cpu")


def memory_fraction(device: Device) -> float:
    """The fraction of the card vLLM may claim: the operator's, or this engine's budget over the card."""
    configured = os.getenv("RHAPSODE_ORPHEUS_GPU_MEMORY")
    if configured:
        return float(configured)
    if not device.vram_bytes:
        return MOST_OF_A_CARD
    return round(min(MOST_OF_A_CARD, FULL_MEMORY_BYTES / device.vram_bytes), 3)


def _snac() -> None:
    """The two files `SNAC.from_pretrained` reads, copied from snac 1.2.1 rather than imported, because
    importing snac imports torch and fetching has no use for it."""
    for filename in ("config.json", "pytorch_model.bin"):
        _download(SNAC_REPOSITORY, filename, SNAC_REVISION)


def _download(repository: str, filename: str, revision: str) -> str:
    from huggingface_hub import hf_hub_download

    path: str = hf_hub_download(
        repo_id=repository,
        filename=filename,
        revision=revision,
        token=os.getenv("HF_TOKEN") or None,
    )
    return path
