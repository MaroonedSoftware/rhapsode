"""Orpheus as a rhapsode engine. protocol.md § 8."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any, ClassVar

from rhapsode_worker import Engine, NativeFormat, SpeakRequest, UnknownVoice, Unsupported, Variant, Voice

from .backends import LlamaCppSource, Sampling, TokenSource
from .builds import DEFAULT_VOICE, GGUF_FILES, GGUF_REPOSITORY, GGUF_REVISION, VOICES, variants
from .codes import Framer
from .decoder import SnacDecoder
from .prompt import MAX_TOKENS, prompt, segments, translate_cues

#: SNAC 24 kHz, mono.
SAMPLE_RATE = 24_000


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
        return variants()

    # ------------------------------------------------------------------ residency

    def load(self, variant: str) -> None:
        if variant not in GGUF_FILES:
            raise Unsupported(f'no build "{variant}"; this engine has {sorted(GGUF_FILES)}')
        accelerated = self.device.type in {"cuda", "rocm", "mps"}
        self._source = LlamaCppSource(_gguf(variant), gpu=accelerated)
        self._decoder = SnacDecoder("cuda" if self.device.type in {"cuda", "rocm"} else "cpu")

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
    import os

    from huggingface_hub import hf_hub_download

    path: str = hf_hub_download(
        repo_id=GGUF_REPOSITORY,
        filename=GGUF_FILES[variant],
        revision=GGUF_REVISION,
        token=os.getenv("HF_TOKEN") or None,
    )
    return path
