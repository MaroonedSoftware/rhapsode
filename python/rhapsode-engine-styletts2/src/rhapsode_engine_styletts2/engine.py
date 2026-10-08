"""StyleTTS 2 as a rhapsode engine. protocol.md § 8."""

from __future__ import annotations

import hashlib
import os
import zipfile
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
    Unsupported,
    Variant,
    Voice,
    segments,
)
from rhapsode_worker.engine import Device

from . import upstream
from .backends import TOKEN_LIMIT, Dials, Synthesiser, UpstreamStyleTTS2
from .builds import (
    ALPHA_RANGE,
    BETA_RANGE,
    DEFAULT_VARIANT,
    DEFAULT_VOICE,
    DIFFUSION_STEPS_RANGE,
    EMBEDDING_SCALE_RANGE,
    FILES,
    REFERENCES,
    REPOSITORY,
    REVISION,
    SAMPLE_RATE,
    STOCK,
    variants,
)

#: 100 ms. The SDK's queue is bounded in chunks, so this is what "how much audio is in flight" means;
#: it also decides how promptly a cancelled request stops being encoded.
CHUNK_SAMPLES = SAMPLE_RATE // 10

#: What one generation is given. PL-BERT stops at 512 phoneme tokens, which English reaches at about
#: 430 characters (1.18 tokens to a character, measured), and a number spelled out takes more than its
#: digits. 300 measured 356 tokens and 19.6 s of speech, which leaves room for the text that spells
#: out long. Anything still over the limit is split again here before it reaches the model.
SEGMENT_CHARACTERS = 300

#: Reference audio upstream's own clips sit at the bottom of: every one of them is 3.0 to 4.3 s.
#: The style encoder averages over the clip, so a longer one buys steadiness and costs only time.
REFERENCE_SECONDS = (3.0, 20.0)

VOICE_SUFFIXES = (".wav", ".mp3", ".flac", ".ogg")


class StyleTTS2Engine(Engine):
    id = "styletts2"
    display_name = "StyleTTS 2"

    # Both, by hand, because deriving one from the other is the mistake § 4 exists to prevent.
    license: ClassVar[dict[str, Any]] = {
        "code": "GPL-3.0-or-later",
        "weights": "MIT",
        "weights_commercial_use": True,
        "notes": "GPL through phonemizer and eSpeak NG; StyleTTS 2 itself is MIT, downloaded from "
        "yl4579/StyleTTS2 at a pinned commit. Weights: yl4579/StyleTTS2-LibriTTS. Upstream's README asks "
        "that listeners be told the speech is synthesised, unless the speaker whose voice is cloned has "
        "given permission; its own LibriTTS speakers are exempt.",
    }

    native_format = NativeFormat(encoding="pcm_s16le", sample_rate=SAMPLE_RATE, channels=1)
    default_variant = DEFAULT_VARIANT

    concurrency = 1
    max_characters = 4096
    #: Joined with no pause: every generation opens with about 260 ms of silence and closes with 320 to
    #: 480 ms, measured, so two pieces are already a sentence's pause apart.
    segment_characters = SEGMENT_CHARACTERS

    upstream_version = upstream.COMMIT[:7]

    _synthesiser: Synthesiser | None = None

    # ------------------------------------------------------------------ what this engine can do

    def variants(self) -> dict[str, Variant]:
        return variants()

    # ------------------------------------------------------------------ residency

    def load(self, variant: str) -> None:
        self._check(variant)
        self._synthesiser = UpstreamStyleTTS2(upstream.ensure(), _weights(), _torch_device(self.device))

    def fetch(self, variant: str) -> None:
        """Download upstream's tree and the checkpoint, where the load finds them.

        141 MB of code and checkpoints from GitHub and 774 MB from the Hub, which a first `/speak`
        caller could not tell from a hang. protocol.md § 8.
        """
        self._check(variant)
        upstream.ensure()
        _stock_dir(_weights())

    def unload(self) -> None:
        self._synthesiser = None
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
        """Upstream's LibriTTS speakers, then whatever was cloned."""
        stock = [
            Voice(
                id=voice,
                label=voice.replace("_", " ")
                .title()
                .replace("Libritts", "LibriTTS")
                .replace("Librispeech", "LibriSpeech"),
                description=f"Speaker {voice.rsplit('_', 1)[1]} of the corpus the model was trained on",
                spec=f"{voice}@{self.variant or self.default_variant}:{REVISION[:7]}",
                tags=("stock", "en"),
            )
            for voice in STOCK
        ]
        if not self.voice_dir.is_dir():
            return stock
        cloned = sorted(path for path in self.voice_dir.iterdir() if path.suffix.lower() in VOICE_SUFFIXES)
        return stock + [self._voice(path) for path in cloned]

    def reference_seconds(self) -> tuple[float, float] | None:
        return REFERENCE_SECONDS

    def reference_formats(self) -> tuple[str, ...]:
        return tuple(suffix.lstrip(".") for suffix in VOICE_SUFFIXES)

    def create_voice(self, request: CreateVoiceRequest) -> Voice:
        """Keep the clip. Cloning is zero-shot and needs no transcript: the style is read from the
        sound alone, so there is nothing to train and nothing to ask for but audio."""
        if request.id in STOCK:
            # Refused rather than stored: `speak` resolves a stock name first, so a clone under one
            # would be kept, listed twice, and never heard.
            raise BadRequest(f'"{request.id}" is one of this engine\'s own voices; choose another id')
        suffix = Path(request.filename or "reference.wav").suffix.lower()
        if suffix not in VOICE_SUFFIXES:
            raise Unsupported(f'reference audio must be one of {", ".join(VOICE_SUFFIXES)}, not "{suffix}"')
        if not request.reference:
            raise BadRequest("the reference audio is empty")

        self.voice_dir.mkdir(parents=True, exist_ok=True)
        # A re-record replaces, whatever the new clip is called. An mp3 over an earlier wav would
        # otherwise leave both, and which one speaks would depend on how the directory sorted.
        for stale in self.voice_dir.iterdir():
            if stale.stem == request.id and stale.suffix.lower() in VOICE_SUFFIXES:
                stale.unlink()
        target = self.voice_dir / f"{request.id}{suffix}"
        target.write_bytes(request.reference)
        return self._voice(target, label=request.label)

    def delete_voice(self, voice_id: str) -> None:
        if voice_id in STOCK:
            raise Unsupported(f'"{voice_id}" is one of this engine\'s own voices and cannot be deleted')
        self.path_for(voice_id).unlink()

    def _voice(self, path: Path, label: str | None = None) -> Voice:
        digest = hashlib.sha256(path.read_bytes()).hexdigest()[:12]
        return Voice(
            id=path.stem,
            label=label or path.stem.replace("_", " ").title(),
            description=f"Cloned from {path.name}",
            # The clip and the resident build. protocol.md § 7.
            spec=f"{path.stem}@{self.variant or self.default_variant}:{digest}",
            tags=("cloned",),
        )

    # ------------------------------------------------------------------ speaking

    def speak(self, request: SpeakRequest) -> Iterator[bytes]:
        """One piece of text, in the voice's style, as PCM.

        The style is read from the clip on every request rather than kept. It measured 10 ms on Metal
        and 70 ms on the CPU, against 470 ms and 1.5 s for the speech it styles, so a cache would
        save a few per cent and hold device memory for every voice it had seen.
        """
        synthesiser = self._synthesiser
        if synthesiser is None:
            raise Unsupported("no model is loaded")

        style = synthesiser.style(self._clip(request.voice))
        dials = self.dials_for(request)
        settings = Dials(
            alpha=dials.get("alpha", ALPHA_RANGE[2]),
            beta=dials.get("beta", BETA_RANGE[2]),
            diffusion_steps=round(dials.get("diffusionSteps", DIFFUSION_STEPS_RANGE[2])),
            embedding_scale=dials.get("embeddingScale", EMBEDDING_SCALE_RANGE[2]),
        )
        for tokens in fitting(synthesiser, request.text):
            yield from pcm(synthesiser.synthesise(tokens, style, settings, request.seed))

    def _clip(self, voice: str | None) -> Path:
        """A stock voice's clip from upstream's archive, or a cloned one, or `unknown_voice`."""
        voice = voice or DEFAULT_VOICE
        if voice in STOCK:
            return _stock_dir(_weights()) / STOCK[voice]
        return self.path_for(voice)


def fitting(synthesiser: Synthesiser, text: str) -> Iterator[list[int]]:
    """The text as token runs the model can take, split again wherever one is over the limit.

    The SDK has already cut at `SEGMENT_CHARACTERS`, which English fits with room to spare. What does
    not fit is text that spells out long, like a string of figures, so that is cut in two at the
    nearest pause by the same splitter and each half tried again.
    """
    tokens = synthesiser.tokens(text)
    if len(tokens) <= TOKEN_LIMIT:
        yield tokens
        return
    halves = segments(text, max(1, len(text) // 2))
    if len(halves) < 2:
        raise BadRequest(
            f"one word here is {len(tokens)} phonemes and this engine reads at most {TOKEN_LIMIT} at a time"
        )
    for half in halves:
        yield from fitting(synthesiser, half)


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


def _weights() -> Path:
    """The pinned checkpoint and clips, downloaded into the Hugging Face cache on first use and found
    there after. The import is here so the adapter is importable without the hub."""
    from huggingface_hub import snapshot_download

    return Path(
        snapshot_download(
            repo_id=REPOSITORY,
            revision=REVISION,
            allow_patterns=list(FILES),
            token=os.getenv("HF_TOKEN") or None,
        )
    )


def _stock_dir(weights: Path) -> Path:
    """The stock voices' clips, unpacked from upstream's archive beside the source tree.

    Not into the Hugging Face cache, which is the hub's to manage, and only the clips `STOCK` names.
    Each is written under a temporary name and renamed, so a clip that is present is whole.
    """
    directory = upstream.source_dir().parent / f"references-{REVISION[:7]}"
    missing = [name for name in STOCK.values() if not (directory / name).is_file()]
    if not missing:
        return directory
    directory.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(weights / REFERENCES) as archive:
        members = {Path(member).name: member for member in archive.namelist()}
        for name in missing:
            staging = directory / f".{name}.partial"
            staging.write_bytes(archive.read(members[name]))
            staging.replace(directory / name)
    return directory


def _torch_device(device: Device) -> str:
    """torch's name for the detected device. ROCm builds of torch answer to "cuda"."""
    return {"cuda": "cuda", "rocm": "cuda", "mps": "mps"}.get(device.type, "cpu")
