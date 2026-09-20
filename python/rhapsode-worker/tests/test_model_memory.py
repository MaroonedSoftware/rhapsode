"""What a load cost, measured and reported. protocol.md § 3."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

import pytest
from conftest import await_handshake, spawn, stop, url_for


def call(base: str, path: str, body: dict[str, Any] | None = None, method: str = "GET") -> dict[str, Any]:
    request = urllib.request.Request(
        f"{base}{path}",
        data=None if body is None else json.dumps(body).encode(),
        headers={} if body is None else {"content-type": "application/json"},
        method=method,
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.loads(response.read())


@pytest.fixture
def heavy():
    started: list = []

    def start(**env: str):
        process = spawn(module="engines.heavy", engine="heavy", env=env)
        handshake = await_handshake(process)
        started.append(process)
        return url_for(handshake)

    yield start
    for process in started:
        stop(process)


class TestMeasuring:
    def test_health_carries_what_the_model_took(self, heavy) -> None:
        # A core deciding what to evict has only ever been given the card's capacity, which says
        # nothing about the difference between an 82M model and a 1.6B one.
        base = heavy()
        assert "modelBytes" not in call(base, "/health")

        loaded = call(base, "/load", {}, method="POST")
        assert loaded["modelBytes"] > 0
        assert call(base, "/health")["modelBytes"] == loaded["modelBytes"]

    def test_the_number_goes_when_the_model_does(self, heavy) -> None:
        base = heavy()
        call(base, "/load", {}, method="POST")

        assert "modelBytes" not in call(base, "/unload", {}, method="POST")
        assert "modelBytes" not in call(base, "/health")

    def test_an_adapter_that_knows_better_is_believed(self, heavy) -> None:
        # The measurement is a card-wide delta and approximate by construction. An adapter with the
        # real figure says so, and the SDK does not argue.
        base = heavy(RHAPSODE_TEST_DECLARED="123456789")

        assert call(base, "/load", {}, method="POST")["modelBytes"] == 123456789

    def test_a_measurement_is_never_zero_or_negative(self) -> None:
        # The tone engine allocates no weights, so its delta is whatever noise the load made: the
        # field is absent or it is positive, never 0. Zero would read as "this model is free" to a
        # core adding up a card, which is the one answer that is certainly wrong.
        process = spawn()
        try:
            base = url_for(await_handshake(process))
            loaded = call(base, "/load", {}, method="POST")
            assert loaded.get("modelBytes", 1) > 0
        finally:
            stop(process)


class TestTheSdkStaysInstallable:
    def test_measuring_memory_does_not_import_torch(self) -> None:
        # The SDK must install into an ONNX or pure-CPU adapter's venv, so torch is imported inside
        # the functions that might use it, exactly as `detect_device` does.
        module = Path(__file__).resolve().parents[1] / "src/rhapsode_worker/memory.py"
        top_level = [
            line
            for line in module.read_text().splitlines()
            if line.startswith("import ") or line.startswith("from ")
        ]

        assert not any("torch" in line for line in top_level), top_level

    def test_the_cpu_answer_is_a_real_number(self) -> None:
        from rhapsode_worker.engine import Device
        from rhapsode_worker.memory import held_bytes

        held = held_bytes(Device(type="cpu", name="test"))
        assert held is not None and held > 0

    def test_a_device_nothing_can_measure_says_so_rather_than_guessing(self) -> None:
        from rhapsode_worker.engine import Device
        from rhapsode_worker.memory import held_bytes

        # No torch in this venv, so the accelerator paths have nothing to ask and answer None.
        assert held_bytes(Device(type="cuda", name="test", vram_bytes=1)) is None
