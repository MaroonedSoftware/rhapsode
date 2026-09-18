"""The tone engine. It makes a sound, and the sound depends on what you asked for."""

from __future__ import annotations

import hashlib
import math
import struct
from collections.abc import Iterator
from pathlib import Path
from typing import Any, ClassVar

from rhapsode_worker import (
    CreateVoiceRequest,
    Engine,
    NativeFormat,
    SpeakRequest,
    Unsupported,
    Variant,
    Voice,
)

SAMPLE_RATE = 24_000

#: Roughly the pace of read speech, so a line's duration is in the right order of magnitude and a
#: test that asserts "longer text makes more audio" means something.
SECONDS_PER_CHARACTER = 0.06

#: A chunk is 100ms. Small enough that a client sees several for any real line, which is what makes
#: the streaming and mid-stream-abort tests possible at all.
CHUNK_SAMPLES = SAMPLE_RATE // 10

#: Where a cloned voice's pitch comes from: somewhere in this range, chosen by the reference's hash.
#: A tone cannot sound like a person, so what cloning proves here is the plumbing, and a clone that
#: sounded the same whatever it was given would prove none of it.
CLONED_HZ = (150.0, 450.0)

VOICES = {
    "sine": (220.0, "A steady sine at A3."),
    "square": (330.0, "A square wave at E4, for something that sounds different."),
    "silence": (0.0, "Silence, for testing that a caller notices."),
}


class ToneEngine(Engine):
    id = "tone"
    display_name = "Tone"
    # Both licences named, because deriving one from the other is the mistake § 4 exists to prevent,
    # and an engine with nothing to hide should still say so.
    license: ClassVar[dict[str, Any]] = {
        "code": "MIT",
        "weights": "MIT",
        "weights_commercial_use": True,
        "notes": "No weights: it is arithmetic.",
    }
    native_format = NativeFormat(encoding="pcm_s16le", sample_rate=SAMPLE_RATE, channels=1)
    adapter_version = "0.0.0"
    default_variant = "plain"

    def variants(self) -> dict[str, Variant]:
        # Two builds that differ in what they can do, because an engine where every variant is
        # identical cannot exercise the one thing the capability document exists for.
        return {
            "plain": Variant(
                cues=("laugh", "sigh"),
                deliveries=(),
                dials={},
                languages=("en",),
            ),
            "dialled": Variant(
                cues=(),
                deliveries=("hushed", "frantic"),
                dials={"pitch": (0.5, 2.0, 1.0), "gain": (0.0, 1.0, 0.5)},
                languages=("en",),
            ),
        }

    #: There is nothing to hold, so this is only ever evidence that load and unload were called.
    _loaded: str | None = None

    def load(self, variant: str) -> None:
        self._loaded = variant

    def unload(self) -> None:
        self._loaded = None

    def voices(self) -> list[Voice]:
        variant = self.effective_variant(None)
        built_in = [
            Voice(
                id=name,
                label=name.title(),
                description=description,
                # The spec changes when the rendering would, which for this engine means the
                # frequency and the variant. Clients key cached previews on it.
                spec=f"{name}@{variant}:{frequency:g}",
                tags=("synthetic", "en"),
            )
            for name, (frequency, description) in VOICES.items()
        ]
        return built_in + [self._cloned(path, variant) for path in self._references()]

    # ---------------------------------------------------------------- cloning

    def create_voice(self, request: CreateVoiceRequest) -> Voice:
        """Store the reference. Its hash picks the pitch, so two clips make two voices."""
        if request.id in VOICES:
            raise Unsupported(f'"{request.id}" is a built-in voice and cannot be replaced')
        if not request.reference:
            raise Unsupported("the reference audio is empty")
        self.voice_dir.mkdir(parents=True, exist_ok=True)
        # One file per id, whatever the upload was called, so a re-record replaces rather than adds.
        for stale in self._references():
            if stale.stem == request.id:
                stale.unlink()
        target = self.voice_dir / f"{request.id}.ref"
        target.write_bytes(request.reference)
        return self._cloned(target, self.effective_variant(None), label=request.label)

    def delete_voice(self, voice_id: str) -> None:
        if voice_id in VOICES:
            raise Unsupported(f'"{voice_id}" is a built-in voice and cannot be deleted')
        self.path_for(voice_id).unlink()

    def _references(self) -> list[Path]:
        if not self.voice_dir.is_dir():
            return []
        return sorted(path for path in self.voice_dir.iterdir() if path.suffix == ".ref" and path.is_file())

    def _cloned(self, path: Path, variant: str, label: str | None = None) -> Voice:
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        return Voice(
            id=path.stem,
            label=label or path.stem.replace("_", " ").title(),
            description=f"Cloned: {_cloned_hz(digest):.0f} Hz",
            # The reference's hash is in it, because a re-recorded voice under the same id renders
            # differently and a client keying a cached preview on the id would serve the old one.
            spec=f"{path.stem}@{variant}:{digest[:12]}",
            tags=("cloned",),
        )

    def _frequency(self, voice: str | None) -> float:
        """A built-in voice's pitch, a cloned one's, or `unknown_voice`, and never a substitute."""
        if voice is None:
            return VOICES["sine"][0]
        if voice in VOICES:
            return VOICES[voice][0]
        return _cloned_hz(hashlib.sha256(self.path_for(voice).read_bytes()).hexdigest())

    def apply_delivery(self, delivery: str | None, dials: dict[str, float]) -> dict[str, float]:
        # Relative to the voice rather than to a fixed point, which is the rule § 5 states and the
        # one an adapter is most likely to get wrong. A voice that is loud at rest stays louder than
        # its neighbours when hushed, because the multiplier applies to whatever it already had.
        if delivery == "hushed":
            return {**dials, "gain": dials.get("gain", 0.5) * 0.4}
        if delivery == "frantic":
            return {**dials, "pitch": min(2.0, dials.get("pitch", 1.0) * 1.3)}
        return dials

    def speak(self, request: SpeakRequest) -> Iterator[bytes]:
        frequency = self._frequency(request.voice)
        dials = self.dials_for(request)
        frequency *= dials.get("pitch", 1.0)
        amplitude = dials.get("gain", 0.5)

        if request.seed is not None:
            # Something a caller can actually check for reproducibility, without pretending the
            # tone is a model. The same seed and text give the same detune, every time.
            digest = hashlib.sha256(f"{request.seed}:{request.text}".encode()).digest()
            frequency *= 1.0 + (digest[0] / 255.0 - 0.5) * 0.02

        total = max(CHUNK_SAMPLES, int(len(request.text) * SECONDS_PER_CHARACTER * SAMPLE_RATE))
        yield from _tone(frequency, amplitude, total, square=request.voice == "square")


def _tone(frequency: float, amplitude: float, samples: int, *, square: bool) -> Iterator[bytes]:
    step = 2.0 * math.pi * frequency / SAMPLE_RATE
    peak = int(32767 * max(0.0, min(1.0, amplitude)))
    written = 0
    while written < samples:
        count = min(CHUNK_SAMPLES, samples - written)
        block = []
        for index in range(written, written + count):
            value = math.sin(step * index)
            if square:
                value = 1.0 if value >= 0 else -1.0
            block.append(int(peak * value))
        written += count
        yield struct.pack(f"<{count}h", *block)


def _cloned_hz(digest: str) -> float:
    low, high = CLONED_HZ
    return low + (int(digest[:8], 16) / 0xFFFFFFFF) * (high - low)
