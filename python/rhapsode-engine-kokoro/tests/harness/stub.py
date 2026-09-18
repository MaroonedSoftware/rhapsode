"""A kokoro-onnx and an espeakng-loader that are neither, shared by the unit tests and the harness.

The real ones bring onnxruntime, a GPL phonemizer, a native eSpeak library and 200 MB of weights, and
none of that is what is under test. What is: which files a variant asks for, what reaches `create`,
how sentences are grouped, and how a waveform becomes PCM.
"""

from __future__ import annotations

import sys
import types
from dataclasses import dataclass, field
from typing import Any


@dataclass
class Call:
    text: str
    voice: str
    speed: float
    lang: str


@dataclass
class StubKokoro:
    model_path: str
    voices_path: str
    espeak_config: Any = None
    calls: list[Call] = field(default_factory=list)

    def create(self, text: str, voice: str, speed: float = 1.0, lang: str = "en-us") -> tuple[Any, int]:
        import numpy as np

        self.calls.append(Call(text=text, voice=voice, speed=speed, lang=lang))
        # Longer text is longer audio and a faster speed is shorter, which is what the conformance
        # suite needs to see that its input reached the model. The audio itself is a ramp.
        samples = max(2_400, int(len(text) * 1_200 / speed))
        return np.linspace(-0.5, 0.5, samples, dtype="float32"), 24_000


@dataclass
class StubEspeakConfig:
    lib_path: str | None = None
    data_path: str | None = None


def install(data_path: str = "/short/espeak-ng-data") -> list[StubKokoro]:
    """Put both stubs on the import path. Returns the list every constructed model is appended to."""
    built: list[StubKokoro] = []

    kokoro = types.ModuleType("kokoro_onnx")

    def construct(model_path: str, voices_path: str, espeak_config: Any = None) -> StubKokoro:
        model = StubKokoro(model_path, voices_path, espeak_config)
        built.append(model)
        return model

    kokoro.Kokoro = construct  # type: ignore[attr-defined]
    kokoro.EspeakConfig = StubEspeakConfig  # type: ignore[attr-defined]

    loader = types.ModuleType("espeakng_loader")
    loader.get_data_path = lambda: data_path  # type: ignore[attr-defined]

    sys.modules["kokoro_onnx"] = kokoro
    sys.modules["espeakng_loader"] = loader
    return built
