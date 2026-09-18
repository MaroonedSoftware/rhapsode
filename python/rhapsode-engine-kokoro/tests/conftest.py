"""Stubs for kokoro-onnx and espeakng-loader, and an engine built the way the SDK builds one."""

from __future__ import annotations

import sys
from collections.abc import Iterator
from pathlib import Path

import pytest
from harness import stub
from rhapsode_worker import Log
from rhapsode_worker.engine import Device

from rhapsode_engine_kokoro.engine import KokoroEngine


@pytest.fixture
def kokoro(monkeypatch: pytest.MonkeyPatch) -> Iterator[list[stub.StubKokoro]]:
    """Every model the test constructs, with both stubs on the import path for its duration."""
    for name in ("kokoro_onnx", "espeakng_loader"):
        monkeypatch.delitem(sys.modules, name, raising=False)
    built = stub.install()
    yield built
    for name in ("kokoro_onnx", "espeakng_loader"):
        sys.modules.pop(name, None)


@pytest.fixture
def engine(tmp_path: Path) -> KokoroEngine:
    built = KokoroEngine()
    built.device = Device(type="cpu", name="test")
    built.voice_dir = tmp_path
    built.log = Log(engine="kokoro")
    built.variant = None
    return built
