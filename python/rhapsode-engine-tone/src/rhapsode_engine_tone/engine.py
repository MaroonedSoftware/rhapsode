"""The tone engine. It makes a sound, and the sound depends on what you asked for."""

from __future__ import annotations

import hashlib
import math
import struct
from collections.abc import Iterator
from typing import Any, ClassVar

from rhapsode_worker import Engine, NativeFormat, SpeakRequest, Variant, Voice

SAMPLE_RATE = 24_000

#: Roughly the pace of read speech, so a line's duration is in the right order of magnitude and a
#: test that asserts "longer text makes more audio" means something.
SECONDS_PER_CHARACTER = 0.06

#: A chunk is 100ms. Small enough that a client sees several for any real line, which is what makes
#: the streaming and mid-stream-abort tests possible at all.
CHUNK_SAMPLES = SAMPLE_RATE // 10

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
        return [
            Voice(
                id=name,
                label=name.title(),
                description=description,
                # The spec changes when the rendering would, which for this engine means the
                # frequency and the variant. Clients key cached previews on it.
                spec=f"{name}@{self.effective_variant(None)}:{frequency:g}",
                tags=("synthetic", "en"),
            )
            for name, (frequency, description) in VOICES.items()
        ]

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
        frequency, _ = VOICES.get(request.voice or "sine", VOICES["sine"])
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
