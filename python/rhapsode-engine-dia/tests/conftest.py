"""The fakes from `harness/stubs.py`, on the import path for the duration of one test."""

from __future__ import annotations

import sys
from collections.abc import Iterator

import pytest
from harness.stubs import Recorder, modules


@pytest.fixture
def dia(monkeypatch: pytest.MonkeyPatch) -> Iterator[Recorder]:
    recorder = Recorder()
    for name, module in modules(recorder).items():
        monkeypatch.setitem(sys.modules, name, module)
    yield recorder
