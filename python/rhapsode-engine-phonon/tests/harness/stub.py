"""A ptts and a huggingface_hub that are neither, shared by the unit tests and the harness.

The real runtime is a native library and the real download is 75 MB, and neither is what is under
test. What is: which files a build asks for, what reaches `stream`, and how a waveform becomes PCM.
"""

from __future__ import annotations

import sys
import types
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class Call:
    text: str
    voice: str | None
    temperature: float | None
    seed: int | None
    conditions: dict[str, Any]


@dataclass
class Download:
    repo_id: str
    revision: str | None
    allow_patterns: list[str]
    token: str | None


class StubResponse:
    def __init__(self, status_code: int) -> None:
        self.status_code = status_code


class StubHfHubHTTPError(Exception):
    def __init__(self, status_code: int) -> None:
        super().__init__(f"HTTP {status_code}")
        self.response = StubResponse(status_code)


class StubStream:
    """The runtime's own context manager, with its growing chunks. `closed` is what a test reads."""

    def __init__(self, chunks: list[Any]) -> None:
        self._chunks = iter(chunks)
        self.closed = False

    def __enter__(self) -> StubStream:
        return self

    def __exit__(self, *_: object) -> bool:
        self.closed = True
        return False

    def __iter__(self) -> StubStream:
        return self

    def __next__(self) -> Any:
        return next(self._chunks)


@dataclass
class StubTTS:
    model: str
    device: str | None = None
    quant: str | None = None
    lang: str | None = None
    added: dict[str, str] = field(default_factory=dict)
    conditions: dict[str, Any] = field(default_factory=dict)
    calls: list[Call] = field(default_factory=list)
    streams: list[StubStream] = field(default_factory=list)

    def add_voice(self, name: str, path: str) -> None:
        self.added[name] = path

    def set_conditions(self, conditions: dict[str, Any]) -> None:
        self.conditions = dict(conditions)

    def stream(
        self,
        text: str,
        *,
        voice: str | None = None,
        temperature: float | None = None,
        seed: int | None = None,
    ) -> StubStream:
        import numpy as np

        self.calls.append(Call(text, voice, temperature, seed, dict(self.conditions)))
        # As the runtime refuses it: nothing the normaliser can read.
        if not any(character.isalnum() for character in text):
            raise ValueError("nothing to synthesize: the text is empty")
        # Longer text is longer audio and a slower delta is longer still, which is what the conformance
        # suite needs to see that its input reached the model. The audio itself is a ramp.
        samples = int(max(4_800, len(text) * 1_200) * (1 + float(self.conditions.get("duration_delta", 0))))
        ramp = np.linspace(-0.5, 0.5, samples, dtype="float32")
        built = StubStream([ramp[: samples // 3], ramp[samples // 3 :]])
        self.streams.append(built)
        return built


def install(
    root: Path, refuse: int | None = None
) -> tuple[list[StubTTS], list[Download], list[int], list[str]]:
    """Put both stubs on the import path. Returns what was built, downloaded, sized and normalised.

    `refuse` is the status every download fails with, as a gated repository answers one.
    """
    built: list[StubTTS] = []
    downloads: list[Download] = []
    threads: list[int] = []
    languages: list[str] = []

    runtime = types.ModuleType("ptts")

    def construct(
        model: str, device: str | None = None, quant: str | None = None, *, lang: str | None
    ) -> StubTTS:
        tts = StubTTS(model, device=device, quant=quant, lang=lang)
        built.append(tts)
        return tts

    def normalize(text: str, lang: str | None = None) -> str:
        languages.append(str(lang))
        # As the real one does: it removes what cannot be read.
        return text if any(character.isalnum() for character in text) else ""

    runtime.TTS = construct  # type: ignore[attr-defined]
    runtime.normalize = normalize  # type: ignore[attr-defined]
    runtime.set_num_threads = threads.append  # type: ignore[attr-defined]

    hub = types.ModuleType("huggingface_hub")

    def snapshot_download(
        repo_id: str,
        revision: str | None = None,
        allow_patterns: list[str] | None = None,
        token: str | None = None,
    ) -> str:
        downloads.append(Download(repo_id, revision, list(allow_patterns or []), token))
        if refuse is not None:
            raise StubHfHubHTTPError(refuse)
        return str(root / repo_id)

    hub.snapshot_download = snapshot_download  # type: ignore[attr-defined]

    sys.modules["ptts"] = runtime
    utils = types.ModuleType("huggingface_hub.utils")
    utils.HfHubHTTPError = StubHfHubHTTPError  # type: ignore[attr-defined]

    sys.modules["huggingface_hub"] = hub
    sys.modules["huggingface_hub.utils"] = utils
    return built, downloads, threads, languages
