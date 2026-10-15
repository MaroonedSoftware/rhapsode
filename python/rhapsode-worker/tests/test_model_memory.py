"""What a load cost, measured and reported. protocol.md § 3."""

from __future__ import annotations

import json
import types
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


class TestWhoseMemory:
    """A card-wide delta counts other processes too. protocol.md § 3."""

    def test_the_card_wide_delta_wins_when_it_is_honest(self) -> None:
        from rhapsode_worker.memory import Snapshot, cost

        # It is the larger figure because it counts the context and what torch never sees.
        assert cost(Snapshot(held=10, own=0), Snapshot(held=310, own=250)) == 300

    def test_another_process_freeing_memory_falls_back_to_our_own_allocator(self) -> None:
        from rhapsode_worker.memory import Snapshot, cost

        gib = 1024**3
        # Chatterbox turbo onto a full card while something else gave 3 GiB back: card-wide, the
        # load looked like it freed memory, and the model was reported as nothing at all.
        before = Snapshot(held=15 * gib, own=0)
        after = Snapshot(held=15 * gib - 3 * gib + int(2.6 * gib), own=int(2.5 * gib))

        assert cost(before, after) == int(2.5 * gib)

    def test_a_card_wide_delta_smaller_than_our_own_is_not_believed(self) -> None:
        from rhapsode_worker.memory import Snapshot, cost

        assert cost(Snapshot(held=0, own=0), Snapshot(held=100, own=400)) == 400

    def test_without_an_allocator_reading_the_card_wide_delta_stands_alone(self) -> None:
        from rhapsode_worker.memory import Snapshot, cost

        assert cost(Snapshot(held=100, own=None), Snapshot(held=900, own=None)) == 800
        assert cost(Snapshot(held=900, own=None), Snapshot(held=100, own=None)) is None

    def test_nothing_measured_is_none_never_zero(self) -> None:
        from rhapsode_worker.memory import Snapshot, cost

        assert cost(Snapshot(None, None), Snapshot(None, None)) is None
        assert cost(Snapshot(held=5, own=7), Snapshot(held=5, own=7)) is None

    def test_a_card_reads_both_the_device_and_torchs_allocator(self, monkeypatch) -> None:
        from rhapsode_worker.engine import Device
        from rhapsode_worker.memory import snapshot

        cuda = types.SimpleNamespace(mem_get_info=lambda: (1_000, 16_000), memory_reserved=lambda: 4_000)
        monkeypatch.setitem(__import__("sys").modules, "torch", types.SimpleNamespace(cuda=cuda))

        assert snapshot(Device(type="cuda", name="test", vram_bytes=16_000)) == (15_000, 4_000)

    def test_off_a_card_there_is_no_separate_allocator_reading(self) -> None:
        from rhapsode_worker.engine import Device
        from rhapsode_worker.memory import own_bytes

        # The resident set and Metal's driver figure are this process alone already.
        assert own_bytes(Device(type="cpu", name="test")) is None
        assert own_bytes(Device(type="mps", name="test")) is None
