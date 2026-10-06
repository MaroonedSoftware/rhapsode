"""Fish Audio S2 Pro as a rhapsode engine. protocol.md § 8."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Any, ClassVar

import numpy as np
from rhapsode_worker import (
    BadRequest,
    CreateVoiceRequest,
    Engine,
    NativeFormat,
    SpeakRequest,
    UnknownVoice,
    Unsupported,
    Variant,
    Voice,
)
from rhapsode_worker.engine import Device

from . import upstream
from .backends import Generator, Reference, Sampling, UpstreamFish
from .builds import (
    DEFAULT_VARIANT,
    FILES,
    REPETITION_PENALTY_RANGE,
    REPOSITORY,
    REVISION,
    TEMPERATURE_RANGE,
    TOP_P_RANGE,
    variants,
)
from .prompt import SEGMENT_CHARACTERS, script, translate_cues
from .voices import REFERENCE_SECONDS, SAMPLE_RATE, clips, digest, load, remove, store

#: 100 ms. The SDK's queue is bounded in chunks, so this is what "how much audio is in flight" means;
#: it also decides how promptly a cancelled request stops being encoded.
CHUNK_SAMPLES = SAMPLE_RATE // 10


class FishEngine(Engine):
    id = "fish"
    display_name = "Fish Audio S2 Pro"

    # Both, by hand, because deriving one from the other is the mistake § 4 exists to prevent. Here
    # the code is under the same research licence as the weights: the worker runs fish-speech, fetched
    # from upstream, not only this adapter's MIT code.
    license: ClassVar[dict[str, Any]] = {
        "code": "Fish-Audio-Research-License",
        "weights": "Fish-Audio-Research-License",
        "weights_commercial_use": False,
        "notes": "https://huggingface.co/fishaudio/s2-pro/blob/main/LICENSE.md. Research and non-commercial "
        "use only; commercial use needs a licence from Fish Audio. Distributing it or a product that uses "
        'it requires the agreement, a notice, and "Built with Fish Audio". The worker runs fish-speech, '
        "downloaded from upstream at a pinned commit.",
    }

    native_format = NativeFormat(encoding="pcm_s16le", sample_rate=SAMPLE_RATE, channels=1)
    default_variant = DEFAULT_VARIANT

    #: One model, one utterance at a time: upstream's model thread takes one request after another.
    concurrency = 1

    max_characters = 4096

    #: Declared, not delegated: this adapter cuts its own text because the pieces are turns of one
    #: conversation upstream carries from each to the next, which is state across the joint. § 8.
    segment_characters = SEGMENT_CHARACTERS
    splits_own_text = True

    upstream_version = upstream.COMMIT[:7]

    _generator: Generator | None = None

    # ------------------------------------------------------------------ what this engine can do

    def variants(self) -> dict[str, Variant]:
        return variants()

    # ------------------------------------------------------------------ residency

    def load(self, variant: str) -> None:
        self._check(variant)
        self._generator = UpstreamFish(upstream.ensure(), _checkpoint(), _torch_device(self.device))

    def unload(self) -> None:
        """Stop the model thread, then ask the runtime for the memory back, which it will not all give."""
        if self._generator is not None:
            self._generator.close()
        self._generator = None
        try:
            import torch

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            elif torch.backends.mps.is_available():
                torch.mps.empty_cache()
        except Exception:
            pass

    def _check(self, variant: str) -> None:
        if variant not in variants():
            raise Unsupported(f'no build "{variant}"; this engine has {sorted(variants())}')

    # ------------------------------------------------------------------ voices

    def voices(self) -> list[Voice]:
        """Only what was cloned. A request naming none is read in whichever voice the model picks,
        which a seed fixes and the conversation holds from the first piece to the last."""
        return [self._voice(clip) for clip in clips(self.voice_dir)]

    def create_voice(self, request: CreateVoiceRequest) -> Voice:
        """Keep the clip at the codec's rate, and the words spoken in it, which Fish needs to clone."""
        return self._voice(store(self.voice_dir, request))

    def delete_voice(self, voice_id: str) -> None:
        remove(self._clip(voice_id))

    def reference_seconds(self) -> tuple[float, float] | None:
        return REFERENCE_SECONDS

    def _voice(self, clip: Path) -> Voice:
        return Voice(
            id=clip.stem,
            label=load(clip).label,
            description="Cloned from a reference and its transcript",
            # The clip and its words, and the resident build. protocol.md § 7.
            spec=f"{clip.stem}@{self.variant or self.default_variant}:{digest(clip)}",
            tags=("cloned",),
        )

    # ------------------------------------------------------------------ speaking

    def speak(self, request: SpeakRequest) -> Iterator[bytes]:
        """The whole text as one conversation, each piece's audio passed on as it is decoded."""
        generator = self._generator
        if generator is None:
            raise Unsupported("no model is loaded")

        text = translate_cues(request.text)
        if not text:
            raise BadRequest(
                "nothing is left to say once Fish's own tags are removed; cues are written [sigh]"
            )
        dials = self.dials_for(request)
        sampling = Sampling(
            temperature=dials.get("temperature", TEMPERATURE_RANGE[2]),
            top_p=dials.get("topP", TOP_P_RANGE[2]),
            repetition_penalty=dials.get("repetitionPenalty", REPETITION_PENALTY_RANGE[2]),
            # One seed for the request: upstream seeds once and samples every piece from there.
            seed=request.seed,
        )
        reference = None if request.voice is None else self._reference(request.voice)
        for audio in generator.stream(script(text), sampling, reference):
            yield from pcm(audio)

    def _reference(self, voice: str) -> Reference:
        """A cloned voice as upstream takes one, or `unknown_voice` and never a substitute."""
        stored = load(self._clip(voice))
        return Reference(audio=stored.clip.read_bytes(), text=translate_cues(stored.transcript))

    def _clip(self, voice: str) -> Path:
        """The voice's clip. `path_for` checks the id and the directory, and answers with whichever file
        has the stem first, which is the `.json` beside it, so the clip is found from that."""
        clip = self.path_for(voice).with_suffix(".wav")
        if not (clip.is_file() and clip.with_suffix(".json").is_file()):
            raise UnknownVoice(f'no voice "{voice}"; this engine has only what was cloned')
        return clip


def pcm(audio: np.ndarray, chunk_samples: int = CHUNK_SAMPLES) -> Iterator[bytes]:
    """Float audio in [-1, 1] as little-endian signed 16-bit PCM, in pieces.

    Clipped before scaling rather than after, because a value slightly outside the range wraps around
    to full-scale of the opposite sign once it is an integer.
    """
    samples = (np.clip(np.asarray(audio, dtype=np.float32).reshape(-1), -1.0, 1.0) * 32767.0).astype("<i2")
    for start in range(0, samples.size, chunk_samples):
        block = samples[start : start + chunk_samples]
        if block.size:
            yield block.tobytes()


def _checkpoint() -> Path:
    """The pinned checkpoint, downloaded into the Hugging Face cache on first use and found there after.

    Upstream loads from a directory, since it reads `codec.pth` and the tokenizer by path. The import
    is here so the adapter is importable without the hub.
    """
    import os

    from huggingface_hub import snapshot_download

    return Path(
        snapshot_download(
            repo_id=REPOSITORY,
            revision=REVISION,
            allow_patterns=list(FILES),
            token=os.getenv("HF_TOKEN") or None,
        )
    )


def _torch_device(device: Device) -> str:
    """torch's name for the detected device. Upstream runs on CUDA, Metal or the CPU; ROCm builds of
    torch answer to "cuda"."""
    return {"cuda": "cuda", "rocm": "cuda", "mps": "mps"}.get(device.type, "cpu")
