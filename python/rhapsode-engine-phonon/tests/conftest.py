"""Stubs for ptts and huggingface_hub, and an engine built the way the SDK builds one."""

from __future__ import annotations

import sys
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import pytest
from harness import stub
from rhapsode_worker import Log
from rhapsode_worker.engine import Device

from rhapsode_engine_phonon import engine as module
from rhapsode_engine_phonon.engine import PhononEngine


@dataclass
class Stubs:
    built: list[stub.StubTTS]
    downloads: list[stub.Download]
    threads: list[int]


@pytest.fixture
def stubs(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Iterator[Stubs]:
    """Both stubs on the import path for the test, and the thread pool not yet sized."""
    for name in ("ptts", "huggingface_hub"):
        monkeypatch.delitem(sys.modules, name, raising=False)
    monkeypatch.setattr(module, "_threads_set", False)
    monkeypatch.delenv("HF_TOKEN", raising=False)
    yield Stubs(*stub.install(tmp_path))
    for name in ("ptts", "huggingface_hub"):
        sys.modules.pop(name, None)


@pytest.fixture
def engine(tmp_path: Path) -> PhononEngine:
    built = PhononEngine()
    built.device = Device(type="cpu", name="test")
    built.voice_dir = tmp_path
    built.log = Log(engine="phonon")
    built.variant = None
    return built
