"""Breeze TTS 2 as a rhapsode engine. protocol.md § 8."""

from __future__ import annotations

import tempfile
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
from rhapsode_worker.listen import StartupError

from .backends import MAX_NEW_TOKENS, SAMPLES_PER_FRAME, EagerBreeze, Generator, Prompt, Sampling
from .builds import (
    DEFAULT_VARIANT,
    FILES,
    REPOSITORY,
    REVISION,
    TEMPERATURE_RANGE,
    TOP_P_RANGE,
    UPSTREAM_COMMIT,
    variants,
)
from .prompt import ANCHOR_CHARACTERS, SEGMENT_CHARACTERS, segments, translate_cues
from .voices import REFERENCE_SECONDS, SAMPLE_RATE, clips, digest, load, remove, store, write

#: 100 ms. The SDK's queue is bounded in chunks, so this is what "how much audio is in flight" means;
#: it also decides how promptly a cancelled request stops being encoded. Upstream's own chunks are
#: two codec frames, 160 ms, so most pass through whole.
CHUNK_SAMPLES = SAMPLE_RATE // 10


class BreezeEngine(Engine):
    id = "breeze"
    display_name = "Breeze TTS 2"

    # Both, by hand, because deriving one from the other is the mistake § 4 exists to prevent, and
    # here they disagree in the way that matters: Apache-2.0 code over research-only weights.
    license: ClassVar[dict[str, Any]] = {
        "code": "Apache-2.0",
        "weights": "BreezeBlue-Research-Non-Commercial",
        "weights_commercial_use": False,
        "notes": "https://huggingface.co/BreezeBlue/Breeze-TTS-2/blob/main/LICENSE. The licence also "
        "covers derivative models and outputs made with the weights on your own hardware. Unauthorized "
        "voice cloning and impersonation are prohibited.",
    }

    native_format = NativeFormat(encoding="pcm_s16le", sample_rate=SAMPLE_RATE, channels=1)
    default_variant = DEFAULT_VARIANT

    #: One model, one utterance at a time. Upstream's own server is "single-concurrency" for the same
    #: reason: its streaming runtime keeps one request's caches.
    concurrency = 1

    max_characters = 4096

    #: Declared, not delegated: this adapter splits its own text because a request with no voice
    #: clones every later piece from its first, which is state across the joint. protocol.md § 8.
    segment_characters = SEGMENT_CHARACTERS
    splits_own_text = True

    upstream_version = UPSTREAM_COMMIT[:7]

    _generator: Generator | None = None

    # ------------------------------------------------------------------ what this engine can do

    def variants(self) -> dict[str, Variant]:
        """The one build, on an NVIDIA card, and on nothing else.

        Upstream's streaming runtime raises "fast streaming requires a CUDA device" on anything else,
        eager path included, and its README asks for a CUDA-capable NVIDIA GPU. A variant every load
        of fails is one a client cannot tell from a slow one (§ 4), and an engine with none cannot
        start, so on any other box the worker says which card it needs rather than the SDK's
        complaint that an engine declared no variants.
        """
        if self.device.type != "cuda":
            raise StartupError(
                f"Breeze TTS 2 needs an NVIDIA card with CUDA, and this box has {self.device.type} "
                f"({self.device.name}): upstream's runtime runs on nothing else"
            )
        return variants()

    # ------------------------------------------------------------------ residency

    def load(self, variant: str) -> None:
        self._check(variant)
        self._generator = EagerBreeze(_checkpoint(), _torch_device(self.device))

    def fetch(self, variant: str) -> None:
        """Download the checkpoint into the Hugging Face cache, where the load finds it.

        The same repository, revision and files the load resolves, so the load that follows is a cache
        hit. They are 7.7 GB, which a first `/speak` caller could not tell from a hang. protocol.md § 8.
        """
        self._check(variant)
        _checkpoint()

    def unload(self) -> None:
        """Drop the model, then ask the runtime for the memory back, which it will not all give."""
        if self._generator is not None:
            self._generator.close()
        self._generator = None
        try:
            import torch

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass

    def _check(self, variant: str) -> None:
        if variant not in variants():
            raise Unsupported(f'no build "{variant}"; this engine has {sorted(variants())}')

    # ------------------------------------------------------------------ voices

    def voices(self) -> list[Voice]:
        """Only what was cloned. Breeze has no voices of its own: a request naming none is read in
        whichever voice the model picks, which a seed fixes."""
        return [self._voice(clip) for clip in clips(self.voice_dir)]

    def create_voice(self, request: CreateVoiceRequest) -> Voice:
        """Keep the clip at the model's rate, and the words spoken in it, which Breeze needs to clone."""
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
        """Stream each piece as the model makes it.

        A cloned voice is the prompt for every piece. A request with no voice has none, and upstream's
        plain template picks a new speaker on every generation, which in one request would be a new
        reader for every piece. So its first piece is kept short and becomes the prompt for the rest:
        the model clones itself, as Dia continues from its own first piece.
        """
        generator = self._generator
        if generator is None:
            raise Unsupported("no model is loaded")

        text = translate_cues(request.text, request.language)
        if not text:
            raise BadRequest(
                "nothing is left to say once Breeze's own tags are removed; cues are written [laugh]"
            )
        dials = self.dials_for(request)

        def sampling(index: int) -> Sampling:
            # The request's seed plus the piece's index, so the whole request reproduces and no two
            # pieces are the same draw. protocol.md § 8.
            return Sampling(
                temperature=dials.get("temperature", TEMPERATURE_RANGE[2]),
                top_p=dials.get("topP", TOP_P_RANGE[2]),
                seed=None if request.seed is None else request.seed + index,
            )

        with tempfile.TemporaryDirectory(prefix="breeze-") as scratch:
            index = 0
            if request.voice is not None:
                prompt = self._cloned(request.voice, request.language)
                rest = text
            else:
                first, *others = segments(text, ANCHOR_CHARACTERS[request.language])
                heard: list[np.ndarray] = []
                for audio in self._generate(generator, first, sampling(index), None):
                    heard.append(audio)
                    yield from pcm(audio)
                anchor = Path(scratch) / "anchor.wav"
                write(anchor, np.concatenate(heard) if heard else np.zeros(0, dtype=np.float32))
                prompt = Prompt(path=anchor, text=first)
                rest = " ".join(others)
                index += 1

            for piece in segments(rest) if rest else []:
                for audio in self._generate(generator, piece, sampling(index), prompt):
                    yield from pcm(audio)
                index += 1

    def _generate(
        self, generator: Generator, text: str, sampling: Sampling, prompt: Prompt | None
    ) -> Iterator[np.ndarray]:
        """One generation, passed through as it streams, with a warning when it ran out of frames."""
        samples = 0
        for audio in generator.stream(text, sampling, prompt):
            samples += audio.size
            yield audio
        if samples >= (MAX_NEW_TOKENS - 2) * SAMPLES_PER_FRAME:
            # Two minutes of audio for at most 300 characters is a model that did not stop, and the
            # piece ends wherever it was. Evidence for the real-weights check.
            self.log.warn(
                "a piece ran to the frame limit", characters=len(text), seconds=samples / SAMPLE_RATE
            )

    def _cloned(self, voice: str, language: str) -> Prompt:
        """A cloned voice as the prompt it is cloned from, or `unknown_voice` and never a substitute."""
        reference = load(self._clip(voice))
        return Prompt(path=reference.clip, text=translate_cues(reference.transcript, language))

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

    Upstream loads from a directory rather than a repository name, since it reads the bundled audio
    tokenizer by path, so this resolves one. The import is here so the adapter is importable without
    the hub.
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
    """torch's name for the detected device, which `variants` has already insisted is CUDA.

    With an index, because upstream's `load_runtime` passes it to `torch.cuda.set_device`, which
    refuses a bare "cuda": the first load on real weights failed with "Expected a torch.device with a
    specified index". The first visible card, which is the one the SDK detected and the one
    `CUDA_VISIBLE_DEVICES` puts first.
    """
    return "cuda:0" if device.type == "cuda" else "cpu"
