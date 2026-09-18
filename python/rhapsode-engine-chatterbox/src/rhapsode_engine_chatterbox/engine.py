"""Chatterbox as a rhapsode engine. protocol.md § 8."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Any, ClassVar

from rhapsode_worker import (
    BadRequest,
    CreateVoiceRequest,
    Engine,
    NativeFormat,
    SpeakRequest,
    Unsupported,
    Variant,
    Voice,
)

from .builds import CFG_WEIGHT_RANGE, DELIVERY_OFFSETS, EXAGGERATION_RANGE, clamp, variants

#: Upstream's S3GEN_SR. Every build synthesises at this rate.
SAMPLE_RATE = 24_000

#: 100ms. The SDK's queue is bounded in chunks, so this is what "how much audio is in flight" means;
#: it also decides how promptly a cancelled request stops being encoded.
CHUNK_SAMPLES = SAMPLE_RATE // 10

#: Reference audio upstream is happy with. Shorter clones badly and longer buys nothing.
REFERENCE_SECONDS = (5.0, 20.0)

VOICE_SUFFIXES = (".wav", ".mp3", ".flac", ".ogg")


def _installed_chatterbox() -> str | None:
    """The upstream version, when it is installed. It is not, in this repository's dev environment."""
    try:
        from importlib.metadata import version

        return version("chatterbox-tts")
    except Exception:
        return None


class ChatterboxEngine(Engine):
    id = "chatterbox"
    display_name = "Chatterbox"

    # Both, by hand, because deriving one from the other is the mistake § 4 exists to prevent. The
    # weights are MIT here, which is the unusual and welcome case; an Apache-2.0 inference stack over
    # research-only weights is the common one, and a scanner reports the first and misses the second.
    license: ClassVar[dict[str, Any]] = {
        "code": "MIT",
        "weights": "MIT",
        "weights_commercial_use": True,
        "notes": "https://github.com/resemble-ai/chatterbox",
    }

    native_format = NativeFormat(encoding="pcm_s16le", sample_rate=SAMPLE_RATE, channels=1)
    default_variant = "turbo"

    #: One model, one utterance at a time. Two concurrent generations on one card contend for the
    #: same weights and do not go twice as fast.
    concurrency = 1

    max_characters = 4096

    #: Which chatterbox is installed, which is a different question from which adapter this is. A
    #: plain attribute rather than a property, because the base class declares it as one and an
    #: override that changes the kind of attribute works right up until somebody subclasses this.
    upstream_version = _installed_chatterbox()

    _model: Any = None

    # ------------------------------------------------------------------ what this engine can do

    def variants(self) -> dict[str, Variant]:
        return variants()

    # ------------------------------------------------------------------ residency

    def load(self, variant: str) -> None:
        """Bring one build onto the device.

        Each build is its own class upstream rather than an argument to one, which is a fact about
        this engine and not about the protocol. The import is here rather than at module scope so
        that the adapter is importable, and testable, without torch.
        """
        import torch
        from chatterbox.mtl_tts import ChatterboxMultilingualTTS
        from chatterbox.tts import ChatterboxTTS
        from chatterbox.tts_turbo import ChatterboxTurboTTS

        builds = {
            "turbo": ChatterboxTurboTTS,
            "original": ChatterboxTTS,
            "multilingual": ChatterboxMultilingualTTS,
        }
        build = builds.get(variant)
        if build is None:
            raise Unsupported(f'no build "{variant}"; this engine has {sorted(builds)}')

        self._model = build.from_pretrained(device=torch.device(self._torch_device()))

    def unload(self) -> None:
        """Drop the model, then ask the runtime for the memory back.

        It will not all come back. An unload reclaims roughly 70% of what the model held because the
        graphics runtime keeps the rest until the process exits, which is why the core has
        `terminate` as well and why a residency manager with only this verb slowly loses a card.
        """
        self._model = None
        try:
            import torch

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            elif torch.backends.mps.is_available():
                torch.mps.empty_cache()
        except Exception:
            pass

    def _torch_device(self) -> str:
        detected = self.device.type
        return "cuda" if detected in {"cuda", "rocm"} else detected

    # ------------------------------------------------------------------ voices

    def voices(self) -> list[Voice]:
        """Whatever reference audio is on disk. A cloned voice is a file, and that is the whole store."""
        if not self.voice_dir.is_dir():
            return []

        found = sorted(path for path in self.voice_dir.iterdir() if path.suffix.lower() in VOICE_SUFFIXES)
        return [
            Voice(
                id=path.stem,
                label=path.stem.replace("_", " ").title(),
                description=f"Cloned from {path.name}",
                # Changes when what this voice SOUNDS like would. The resident build is part of that:
                # the same reference read by turbo and by original are two different renderings, and a
                # client keying a cached preview on the id alone would serve the wrong one forever.
                spec=f"{path.stem}@{self.variant or self.default_variant}",
                tags=("cloned",),
            )
            for path in found
        ]

    def create_voice(self, request: CreateVoiceRequest) -> Voice:
        """Store the reference audio. Cloning here is zero-shot, so there is nothing to train."""
        self.voice_dir.mkdir(parents=True, exist_ok=True)
        suffix = Path(request.filename or "reference.wav").suffix.lower()
        if suffix not in VOICE_SUFFIXES:
            raise Unsupported(f'reference audio must be one of {", ".join(VOICE_SUFFIXES)}, not "{suffix}"')
        if not request.reference:
            raise BadRequest("the reference audio is empty")

        target = self.voice_dir / f"{request.id}{suffix}"
        target.write_bytes(request.reference)
        return Voice(
            id=request.id,
            label=request.label or request.id,
            description=f"Cloned from {target.name}",
            spec=f"{request.id}@{self.variant or self.default_variant}",
            tags=("cloned",),
        )

    def delete_voice(self, voice_id: str) -> None:
        path = self.path_for(voice_id)
        path.unlink()

    def reference_seconds(self) -> tuple[float, float] | None:
        return REFERENCE_SECONDS

    # ------------------------------------------------------------------ deliveries

    def apply_delivery(self, delivery: str | None, dials: dict[str, float]) -> dict[str, float]:
        """A direction, taken from wherever the voice already is. protocol.md § 5.

        Each word is an offset on the dials the request resolved to rather than a fixed point, so the
        two compose: a voice that is intense at rest is still more intense than its neighbours when
        hushed, and a calm one is still calmer when frantic. Hard-coding `exaggeration = 0.2` for
        hushed would throw away whatever made that voice itself, and make every hushed line sound
        alike whoever was reading it.

        Both dials move together whenever a delivery is asked for, because a reading is the pair.
        Sending one and leaving the other at its default is half a delivery.
        """
        offsets = DELIVERY_OFFSETS.get(delivery or "")
        if offsets is None:
            return dials

        exaggeration = dials.get("exaggeration", EXAGGERATION_RANGE[2]) + offsets["exaggeration"]
        cfg_weight = dials.get("cfgWeight", CFG_WEIGHT_RANGE[2]) + offsets["cfgWeight"]

        return {
            **dials,
            "exaggeration": clamp(exaggeration, EXAGGERATION_RANGE[0], EXAGGERATION_RANGE[1]),
            "cfgWeight": clamp(cfg_weight, CFG_WEIGHT_RANGE[0], CFG_WEIGHT_RANGE[1]),
        }

    # ------------------------------------------------------------------ speaking

    def speak(self, request: SpeakRequest) -> Iterator[bytes]:
        """Synthesise, then hand the SDK PCM.

        Upstream has no streaming generate: every build returns the whole waveform at once. So this
        chunks a finished tensor rather than pretending to be incremental, which is honest about the
        latency and still gives the SDK, the encoder and the core something to move.
        """
        if self._model is None:
            raise Unsupported("no model is loaded")

        variant = self.effective_variant(request.variant)
        arguments = self._arguments(request, variant)
        waveform = self._model.generate(request.text, **arguments)

        yield from chunked_pcm(waveform, CHUNK_SAMPLES)

    def _arguments(self, request: SpeakRequest, variant: str) -> dict[str, Any]:
        """Exactly what this build accepts, and nothing it would only warn about."""
        arguments: dict[str, Any] = {}

        if request.voice is not None:
            arguments["audio_prompt_path"] = str(self.path_for(request.voice))

        if request.seed is not None:
            self._seed(request.seed)

        if variant == "turbo":
            # Zero on purpose. Anything above it makes upstream log that CFG, min_p and exaggeration
            # are unsupported and ignore them, and the capability document already says this build
            # has no dials, so a non-zero value here could only have come from the SDK ignoring it.
            return {**arguments, "exaggeration": 0.0, "cfg_weight": 0.0, "min_p": 0.0}

        dials = self.dials_for(request)
        arguments["exaggeration"] = dials.get("exaggeration", EXAGGERATION_RANGE[2])
        arguments["cfg_weight"] = dials.get("cfgWeight", CFG_WEIGHT_RANGE[2])

        if variant == "multilingual":
            arguments["language_id"] = request.language

        return arguments

    def _seed(self, seed: int) -> None:
        """Reproducibility where the engine can manage it, which is every generator it touches."""
        import random

        import torch

        random.seed(seed)
        torch.manual_seed(seed)
        if torch.cuda.is_available():
            torch.cuda.manual_seed_all(seed)


def chunked_pcm(waveform: Any, chunk_samples: int = CHUNK_SAMPLES) -> Iterator[bytes]:
    """A float waveform in [-1, 1] as little-endian signed 16-bit PCM, in pieces.

    Clipped before scaling rather than after, because a value slightly outside the range wraps around
    to full-scale of the opposite sign once it is an integer: a moment of loudness becomes a click,
    which is exactly the artefact nobody hears until it airs.
    """
    import numpy as np

    samples = np.asarray(waveform, dtype=np.float32).reshape(-1)
    clipped = np.clip(samples, -1.0, 1.0)
    pcm = (clipped * 32767.0).astype("<i2")

    for start in range(0, pcm.size, chunk_samples):
        block = pcm[start : start + chunk_samples]
        if block.size:
            yield block.tobytes()
