"""The fakes from `harness/stubs.py`, in place for the duration of one test."""

from __future__ import annotations

import sys
from collections.abc import Iterator
from pathlib import Path

import pytest
from harness.stubs import FakeStyleTTS2, Recorder, hub, weights

from rhapsode_engine_styletts2 import engine, upstream


@pytest.fixture
def styletts2(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Iterator[Recorder]:
    recorder = Recorder()
    monkeypatch.setattr(FakeStyleTTS2, "recorder", recorder, raising=False)
    monkeypatch.setattr(engine, "UpstreamStyleTTS2", FakeStyleTTS2)
    monkeypatch.setitem(sys.modules, "huggingface_hub", hub(recorder, weights(tmp_path / "hub")))
    # A source tree that is already here, so nothing reaches GitHub. The stock clips unpack beside it.
    source = tmp_path / "cache" / "source"
    source.mkdir(parents=True)
    (source / upstream.MARKER).write_text(upstream.TREE_DIGEST)
    monkeypatch.setenv("RHAPSODE_STYLETTS2_SOURCE", str(source))
    yield recorder
