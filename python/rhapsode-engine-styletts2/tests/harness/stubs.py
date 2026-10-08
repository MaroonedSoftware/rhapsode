"""A StyleTTS 2 that is not StyleTTS 2: the synthesiser and the hub, as fakes.

The real ones bring torch, upstream's tree and 900 MB of checkpoints, which is why every engine gets
its own virtualenv and why none of them is in this repository's dev environment. What is under test
is the adapter: which clip a voice reads its style from, which dials reach the model, how text over
the model's limit is cut, and how a waveform becomes PCM. The fake answers all of those at the seam
`backends.Synthesiser` draws, which is where torch begins.

Its output varies with everything it was given, because that is what a real model does and it is the
only way the conformance suite can see that a dial or a seed reached the model. The audio is noise;
only its length and its content depend on the input. A request that is not seeded is not
reproducible, as it is not for real.

What this cannot check is whether the audio is speech, or whether it sounds like the clip. Only real
weights answer that, which is what the README's measurements are.
"""

from __future__ import annotations

import hashlib
import io
import random
import sys
import tempfile
import types
import wave
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

from rhapsode_engine_styletts2 import builds

#: Samples of audio per phoneme token: 100 ms, so a short line is a second or two.
SAMPLES_PER_TOKEN = 2_400


@dataclass
class Generation:
    tokens: list[int]
    style: str
    dials: Any
    seed: int | None


@dataclass
class Recorder:
    loads: list[dict[str, Any]] = field(default_factory=list)
    styles: list[str] = field(default_factory=list)
    generations: list[Generation] = field(default_factory=list)
    downloads: list[dict[str, Any]] = field(default_factory=list)


class FakeStyleTTS2:
    """One token a character, so a test can say how long a text is in tokens by counting."""

    recorder: Recorder

    def __init__(self, source: Path, weights: Path, device: str) -> None:
        self.recorder.loads.append({"source": source, "weights": weights, "device": device})

    def tokens(self, text: str) -> list[int]:
        return [0, *(ord(character) % 177 + 1 for character in text.strip())]

    def style(self, clip: Path) -> str:
        self.recorder.styles.append(clip.name)
        return hashlib.sha256(clip.read_bytes()).hexdigest()

    def synthesise(self, tokens: list[int], style: str, dials: Any, seed: int | None) -> np.ndarray:
        self.recorder.generations.append(Generation(list(tokens), style, dials, seed))
        noise = random.getrandbits(32) if seed is None else seed
        digest = hashlib.sha256(repr((tokens, style, dials, noise)).encode()).digest()
        generator = np.random.default_rng(int.from_bytes(digest[:8], "little"))
        return generator.uniform(-0.5, 0.5, len(tokens) * SAMPLES_PER_TOKEN).astype(np.float32)


def clip(seconds: float = 3.0, pitch: int = 1) -> bytes:
    """A WAV the size of upstream's reference clips."""
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(builds.SAMPLE_RATE)
        samples = (np.sin(np.arange(int(seconds * builds.SAMPLE_RATE)) * pitch / 20) * 8000).astype("<i2")
        out.writeframes(samples.tobytes())
    return buffer.getvalue()


def weights(directory: Path) -> Path:
    """The snapshot the hub would hand back: upstream's reference clips, zipped as it zips them."""
    directory.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(directory / builds.REFERENCES, "w") as archive:
        for index, name in enumerate([*builds.STOCK.values(), "Gavin.wav", "anger.wav"]):
            archive.writestr(f"reference_audio/{name}", clip(pitch=index + 1))
    return directory


def hub(recorder: Recorder, snapshot: Path) -> types.ModuleType:
    module = types.ModuleType("huggingface_hub")

    def snapshot_download(**arguments: Any) -> str:
        recorder.downloads.append(arguments)
        return str(snapshot)

    module.snapshot_download = snapshot_download  # type: ignore[attr-defined]
    return module


def install(recorder: Recorder | None = None) -> Recorder:
    """For a whole process: the served harness."""
    from rhapsode_engine_styletts2 import engine

    recorder = recorder or Recorder()
    FakeStyleTTS2.recorder = recorder
    engine.UpstreamStyleTTS2 = FakeStyleTTS2  # type: ignore[assignment,misc]
    sys.modules["huggingface_hub"] = hub(recorder, weights(Path(tempfile.mkdtemp(prefix="styletts2-hub-"))))
    return recorder
