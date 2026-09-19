"""A Chatterbox that is not Chatterbox.

The real thing brings torch and several gigabytes of weights, which is exactly why every engine gets
its own virtualenv and exactly why it is not in this repository's dev environment. What is under test
here is the adapter: which build gets loaded, what arguments reach `generate`, how a delivery becomes
numbers, and how a waveform becomes PCM. A stub answers all of those, and none of them are questions
about the model.

What this cannot check is whether the audio is any good, or whether `turbo` really performs a laugh.
Only real weights answer that, and `rhapsode-conform` against a real install is where it gets asked.
"""

from __future__ import annotations

import sys
import types
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any

import pytest


@dataclass
class Recorded:
    """One call to `generate`, kept so a test can assert on what the adapter decided to send."""

    text: str
    arguments: dict[str, Any]


@dataclass
class StubBuild:
    """Stands in for one of upstream's builds."""

    name: str
    calls: list[Recorded] = field(default_factory=list)
    samples: int = 24_000
    #: Unit tests want a predictable length; a worker under the conformance suite wants audio that
    #: varies with its input, because "did this cue reach the model" is only visible that way.
    fixed_length: bool = True

    def generate(self, text: str, **arguments: Any) -> Any:
        import numpy as np

        self.calls.append(Recorded(text=text, arguments=arguments))
        # Varies with everything it was given, which is what a real model does and what the
        # conformance suite needs in order to see that a cue reached it at all. It is not pretending
        # to be a model: the audio is a ramp, and only its length and pitch depend on the input.
        digest = abs(hash((text, tuple(sorted(map(str, arguments.items())))))) % 997
        samples = self.samples if self.fixed_length else max(2400, len(text) * 1200)
        ramp = np.linspace(-0.5, 0.5, samples, dtype="float32")
        return (ramp * (1.0 - digest / 2000.0)).reshape(1, -1)


class StubFactory:
    def __init__(self, name: str, registry: dict[str, StubBuild]) -> None:
        self._name = name
        self._registry = registry

    def from_pretrained(self, device: Any, nano: bool = False) -> StubBuild:
        # Upstream's turbo class loads nano too, when asked; `nano` is its argument and only its.
        name = "nano" if nano else self._name
        build = StubBuild(name=name)
        build.device = device  # type: ignore[attr-defined]
        self._registry[name] = build
        return build


@pytest.fixture
def chatterbox(monkeypatch: pytest.MonkeyPatch) -> Iterator[dict[str, StubBuild]]:
    """Put a fake `chatterbox` and a fake `torch` on the import path for the duration of a test."""
    registry: dict[str, StubBuild] = {}

    torch = types.ModuleType("torch")
    torch.device = lambda name: f"device:{name}"  # type: ignore[attr-defined]
    torch.manual_seed = lambda seed: registry.setdefault("_seeded", seed)  # type: ignore[attr-defined]
    cuda = types.SimpleNamespace(
        is_available=lambda: False, empty_cache=lambda: None, manual_seed_all=lambda s: None
    )
    torch.cuda = cuda  # type: ignore[attr-defined]
    torch.backends = types.SimpleNamespace(mps=types.SimpleNamespace(is_available=lambda: False))  # type: ignore[attr-defined]
    torch.mps = types.SimpleNamespace(empty_cache=lambda: None)  # type: ignore[attr-defined]

    package = types.ModuleType("chatterbox")
    tts = types.ModuleType("chatterbox.tts")
    tts.ChatterboxTTS = StubFactory("original", registry)  # type: ignore[attr-defined]
    turbo = types.ModuleType("chatterbox.tts_turbo")
    turbo.ChatterboxTurboTTS = StubFactory("turbo", registry)  # type: ignore[attr-defined]
    mtl = types.ModuleType("chatterbox.mtl_tts")
    mtl.ChatterboxMultilingualTTS = StubFactory("multilingual", registry)  # type: ignore[attr-defined]

    for name, module in {
        "torch": torch,
        "chatterbox": package,
        "chatterbox.tts": tts,
        "chatterbox.tts_turbo": turbo,
        "chatterbox.mtl_tts": mtl,
    }.items():
        monkeypatch.setitem(sys.modules, name, module)

    yield registry
