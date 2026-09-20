"""The tone engine. It makes a sound, and the sound depends on what you asked for."""

from __future__ import annotations

import hashlib
import json
import math
import struct
from collections.abc import Iterator
from pathlib import Path
from typing import Any, ClassVar

from rhapsode_worker import (
    BlendRequest,
    CreateVoiceRequest,
    DialogueRequest,
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

#: What one generation gets, where the SDK splits for this engine. Small, because every character
#: costs SECONDS_PER_CHARACTER of audio a test then has to carry.
SEGMENT_CHARACTERS = 200

#: Silence between two pieces. Non-zero so that the join is a thing a test can hear, and so that the
#: default of nothing is not the only path CI ever runs.
SEGMENT_PAUSE_MS = 100

#: The pitch of each speaker a dialogue gives no voice, in the order they first speak. A fifth above
#: the last, so two unvoiced speakers are two sounds, which is all a conversation of tones can prove.
UNVOICED_HZ = (220.0, 330.0)

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
    # The reference engine is the one that proves the SDK splits, so it declares a split it does not
    # need: arithmetic has no context window. The numbers are small on purpose, so a check can pass
    # text past the segment without paying for a minute of audio to find out. protocol.md § 8.
    segment_characters = SEGMENT_CHARACTERS
    segment_pause_ms = SEGMENT_PAUSE_MS

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
        return (
            built_in
            + [self._cloned(path, variant) for path in self._references()]
            + [self._blended(path, variant) for path in self._blends()]
        )

    # ---------------------------------------------------------------- cloning

    def create_voice(self, request: CreateVoiceRequest) -> Voice:
        """Store the reference. Its hash picks the pitch, so two clips make two voices."""
        if request.id in VOICES:
            raise Unsupported(f'"{request.id}" is a built-in voice and cannot be replaced')
        if not request.reference:
            raise Unsupported("the reference audio is empty")
        self._clear(request.id)
        target = self.voice_dir / f"{request.id}.ref"
        target.write_bytes(request.reference)
        return self._cloned(target, self.effective_variant(None), label=request.label)

    def blend_voice(self, request: BlendRequest) -> Voice:
        """A pitch mixed from the components' pitches, in their shares, resolved and stored now."""
        if request.id in VOICES:
            raise Unsupported(f'"{request.id}" is a built-in voice and cannot be replaced')
        # Resolved before anything is cleared, so a blend that names the voice it replaces reads the
        # old one rather than finding it gone.
        frequency = sum(self._frequency(name) * share for name, share in request.components)
        self._clear(request.id)
        target = self.voice_dir / f"{request.id}.blend"
        target.write_text(json.dumps({"recipe": request.recipe, "hz": frequency}))
        return self._blended(target, self.effective_variant(None), label=request.label)

    def _clear(self, voice_id: str) -> None:
        """One file per id, whatever made it, so a re-record replaces rather than adds."""
        self.voice_dir.mkdir(parents=True, exist_ok=True)
        for stale in self._references() + self._blends():
            if stale.stem == voice_id:
                stale.unlink()

    def delete_voice(self, voice_id: str) -> None:
        if voice_id in VOICES:
            raise Unsupported(f'"{voice_id}" is a built-in voice and cannot be deleted')
        self.path_for(voice_id).unlink()

    def _references(self) -> list[Path]:
        if not self.voice_dir.is_dir():
            return []
        return sorted(path for path in self.voice_dir.iterdir() if path.suffix == ".ref" and path.is_file())

    def _blends(self) -> list[Path]:
        if not self.voice_dir.is_dir():
            return []
        return sorted(path for path in self.voice_dir.iterdir() if path.suffix == ".blend" and path.is_file())

    def _blended(self, path: Path, variant: str, label: str | None = None) -> Voice:
        stored = json.loads(path.read_text())
        return Voice(
            id=path.stem,
            label=label or path.stem.replace("_", " ").title(),
            description=f"Blended from {stored['recipe']}: {stored['hz']:.0f} Hz",
            # The resolved pitch, not the recipe: the same recipe over a re-recorded component
            # renders differently, and the spec follows the rendering.
            spec=f"{path.stem}@{variant}:{stored['hz']:.3f}",
            tags=("blended",),
        )

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
        path = self.path_for(voice)
        if path.suffix == ".blend":
            return float(json.loads(path.read_text())["hz"])
        return _cloned_hz(hashlib.sha256(path.read_bytes()).hexdigest())

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
        dials = self.dials_for(request)
        yield from self._line(
            request.text, self._frequency(request.voice), dials, request.seed, request.voice
        )

    def dialogue(self, request: DialogueRequest) -> Iterator[bytes]:
        """Each turn in its speaker's pitch, one after another.

        A tone cannot overlap two people the way a dialogue model does, so what this proves is the
        plumbing: a speaker keeps one pitch from turn to turn, a voiced one sounds like its voice, and
        an unknown voice is refused before any audio.
        """
        pitches = {
            speaker: self._frequency(request.voices[speaker])
            if speaker in request.voices
            else UNVOICED_HZ[index % len(UNVOICED_HZ)]
            for index, speaker in enumerate(request.speakers)
        }
        dials = self.dials_for(request)
        for index, turn in enumerate(request.turns):
            seed = None if request.seed is None else request.seed + index
            voice = request.voices.get(turn.speaker)
            yield from self._line(turn.text, pitches[turn.speaker], dials, seed, voice)

    def _line(
        self, text: str, frequency: float, dials: dict[str, float], seed: int | None, voice: str | None
    ) -> Iterator[bytes]:
        frequency *= dials.get("pitch", 1.0)
        amplitude = dials.get("gain", 0.5)

        if seed is not None:
            # Something a caller can actually check for reproducibility, without pretending the
            # tone is a model. The same seed and text give the same detune, every time.
            digest = hashlib.sha256(f"{seed}:{text}".encode()).digest()
            frequency *= 1.0 + (digest[0] / 255.0 - 0.5) * 0.02

        total = max(CHUNK_SAMPLES, int(len(text) * SECONDS_PER_CHARACTER * SAMPLE_RATE))
        yield from _tone(frequency, amplitude, total, square=voice == "square")


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
