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

import hashlib
import sys
import types
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pytest


@dataclass
class Recorded:
    """One call to `generate`, kept so a test can assert on what the adapter decided to send."""

    text: str
    arguments: dict[str, Any]
    #: Whose voice the build was holding when it spoke: "stock", or "cloned:<file>".
    conds: str = "stock"


@dataclass
class StubBuild:
    """Stands in for one of upstream's builds."""

    name: str
    calls: list[Recorded] = field(default_factory=list)
    samples: int = 24_000
    #: Unit tests want a predictable length; a worker under the conformance suite wants audio that
    #: varies with its input, because "did this cue reach the model" is only visible that way.
    fixed_length: bool = True

    #: Upstream's `conds`: what the build speaks as when `generate` is handed no reference. It
    #: starts as the build's own voice and a clone overwrites it, exactly as upstream's does.
    conds: str = "stock"
    #: Every reference upstream would have analysed, in order.
    prepared: list[str] = field(default_factory=list)

    def prepare_conditionals(self, wav_fpath: str, exaggeration: float = 0.5, **options: Any) -> None:
        del exaggeration, options
        self.prepared.append(wav_fpath)
        self.conds = f"cloned:{Path(wav_fpath).name}"

    def generate(self, text: str, audio_prompt_path: str | None = None, **arguments: Any) -> Any:
        import numpy as np

        if audio_prompt_path:
            self.prepare_conditionals(audio_prompt_path)
            arguments = {**arguments, "audio_prompt_path": audio_prompt_path}
        self.calls.append(Recorded(text=text, arguments=arguments, conds=self.conds))
        arguments = {**arguments, "conds": self.conds}
        arguments.pop("audio_prompt_path", None)
        # Varies with everything it was given, which is what a real model does and what the
        # conformance suite needs in order to see that a cue reached it at all. It is not pretending
        # to be a model: the audio is a ramp, and only its length and pitch depend on the input.
        # hashlib, never hash(): a str's hash() is salted per process, so two requests that differ
        # collided mod 997 on roughly one hash seed in 600, and conformance, which compares a couple of
        # dozen such pairs, failed a CI run on 'delivery "frantic" changes the audio'. A stable digest
        # passes or fails the same way on every run.
        digest = (
            int(hashlib.sha256(repr((text, sorted(map(str, arguments.items())))).encode()).hexdigest(), 16)
            % 997
        )
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
