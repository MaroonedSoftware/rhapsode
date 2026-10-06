"""The fakes from `harness/stubs.py`, on the import path for the duration of one test."""

from __future__ import annotations

import sys
from collections.abc import Iterator
from pathlib import Path

import pytest
from harness.stubs import Recorder, modules

from rhapsode_engine_fish import upstream


@pytest.fixture
def fish(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Iterator[Recorder]:
    recorder = Recorder()
    for name, module in modules(recorder).items():
        monkeypatch.setitem(sys.modules, name, module)
    # A source tree that is already here, so nothing reaches GitHub, and a path that is put back.
    source = tmp_path / "fish-speech"
    source.mkdir()
    (source / upstream.MARKER).write_text(upstream.TREE_DIGEST)
    monkeypatch.setenv("RHAPSODE_FISH_SOURCE", str(source))
    monkeypatch.setattr(sys, "path", list(sys.path))
    yield recorder
