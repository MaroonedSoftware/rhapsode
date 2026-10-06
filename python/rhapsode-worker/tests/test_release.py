"""What an unload gives back, cycles included. protocol.md § 3."""

from __future__ import annotations

import asyncio
import gc
import sys
import types
import weakref
from collections.abc import Iterator
from typing import Any, ClassVar

import pytest

from rhapsode_worker import Engine, Log, SpeakRequest, Variant, Voice
from rhapsode_worker.engine import Device
from rhapsode_worker.memory import release
from rhapsode_worker.worker import Worker


class Weights:
    """Stands in for a model that holds itself in a cycle, as a parametrised layer does."""

    def __init__(self) -> None:
        self.me = self


class Cyclic(Engine):
    id = "cyclic"
    display_name = "Cyclic"
    license: ClassVar[dict[str, Any]] = {"code": "MIT", "weights": "MIT", "weights_commercial_use": True}

    def __init__(self, raise_on_unload: bool = False) -> None:
        self.weights: Weights | None = None
        self.raise_on_unload = raise_on_unload

    def variants(self) -> dict[str, Variant]:
        return {"only": Variant()}

    def load(self, variant: str) -> None:
        self.weights = Weights()

    def unload(self) -> None:
        self.weights = None
        if self.raise_on_unload:
            raise RuntimeError("the adapter's unload went wrong")

    def voices(self) -> list[Voice]:
        return []

    def speak(self, request: SpeakRequest) -> Iterator[bytes]:
        yield b""


@pytest.fixture
def no_automatic_collection() -> Iterator[None]:
    # Otherwise the collector may run by itself between the unload and the check, and the test
    # would pass without the worker doing anything.
    gc.disable()
    try:
        yield
    finally:
        gc.enable()


def loaded(engine: Cyclic) -> tuple[Worker, weakref.ref[Weights]]:
    engine.device = Device(type="cpu", name="test")
    worker = Worker(engine, 1, Log(engine="cyclic"))
    engine.load("only")
    assert engine.weights is not None
    held = weakref.ref(engine.weights)
    worker.model = "loaded"
    engine.variant = "only"
    return worker, held


@pytest.mark.usefixtures("no_automatic_collection")
def test_an_unload_frees_a_model_held_in_a_cycle() -> None:
    worker, held = loaded(Cyclic())
    asyncio.run(worker.unload())
    assert held() is None
    assert worker.model == "unloaded"


@pytest.mark.usefixtures("no_automatic_collection")
def test_it_frees_it_even_when_the_adapters_unload_raises() -> None:
    worker, held = loaded(Cyclic(raise_on_unload=True))
    asyncio.run(worker.unload())
    assert held() is None


@pytest.mark.usefixtures("no_automatic_collection")
def test_without_the_collection_the_cycle_would_survive() -> None:
    # The premise: dropping the last name does not free a cycle.
    weights = Weights()
    held = weakref.ref(weights)
    del weights
    assert held() is not None
    release()
    assert held() is None


def test_release_empties_the_device_cache_only_through_a_torch_already_imported(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    emptied: list[str] = []
    torch: Any = types.ModuleType("torch")
    torch.cuda = types.SimpleNamespace(is_available=lambda: True, empty_cache=lambda: emptied.append("cuda"))
    torch.backends = types.SimpleNamespace(mps=types.SimpleNamespace(is_available=lambda: False))
    monkeypatch.setitem(sys.modules, "torch", torch)
    release()
    assert emptied == ["cuda"]


def test_release_does_not_import_torch(monkeypatch: pytest.MonkeyPatch) -> None:
    # An ONNX or CPU adapter installs this SDK without torch, and must be able to unload.
    monkeypatch.delitem(sys.modules, "torch", raising=False)
    release()
    assert "torch" not in sys.modules
