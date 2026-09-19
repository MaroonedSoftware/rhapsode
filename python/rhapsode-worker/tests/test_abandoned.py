"""A synthesis the client abandoned still holds the device until it ends. protocol.md § 3.

A model's `generate()` is one blocking call. A client that hangs up stops the stream, but the call
runs to its end on a thread, on the device. The worker used to let the next load, unload or synthesis
go ahead the moment the request was gone: measured with Dia on Metal, a load that started while an
abandoned generation was still running killed the process with "failed assertion _status <
MTLCommandBufferStatusCommitted".
"""

from __future__ import annotations

import contextlib
import json
import urllib.request
from collections.abc import Iterator
from pathlib import Path

import pytest
from conftest import await_handshake, spawn, stop, url_for


@pytest.fixture
def blocking(tmp_path: Path) -> Iterator[tuple[str, Path]]:
    events = tmp_path / "events"
    process = spawn(
        module="engines.blocking",
        engine="blocking",
        env={"RHAPSODE_TEST_EVENTS": str(events), "RHAPSODE_TEST_SECONDS": "2"},
    )
    try:
        yield url_for(await_handshake(process)), events
    finally:
        stop(process)


def post(base: str, path: str, body: dict[str, object], timeout: float = 30) -> int:
    request = urllib.request.Request(
        f"{base}{path}", data=json.dumps(body).encode(), headers={"content-type": "application/json"}
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return int(response.status)


def abandon(base: str, body: dict[str, object]) -> None:
    """Ask for audio, then hang up while the engine is still inside its one blocking call."""
    with contextlib.suppress(OSError):
        post(base, "/speak", body, timeout=0.5)


def events(path: Path) -> list[str]:
    return [line.split(" ", 1)[1] for line in path.read_text().splitlines()]


@pytest.mark.parametrize("stream", [False, True])
def test_an_unload_waits_for_an_abandoned_synthesis_to_end(blocking: tuple[str, Path], stream: bool) -> None:
    base, path = blocking
    post(base, "/load", {"variant": "only"})
    abandon(base, {"text": "x", "stream": stream})
    post(base, "/unload", {})
    assert events(path) == ["load only", "speak begins", "speak ends", "unload"]


def test_a_load_of_another_variant_waits_too(blocking: tuple[str, Path]) -> None:
    base, path = blocking
    post(base, "/load", {"variant": "only"})
    abandon(base, {"text": "x", "stream": False})
    post(base, "/load", {"variant": "other"})
    assert events(path) == ["load only", "speak begins", "speak ends", "unload", "load other"]


def test_the_next_synthesis_waits_for_the_abandoned_one(blocking: tuple[str, Path]) -> None:
    # One model, one utterance at a time is what `concurrency = 1` promises, and an abandoned
    # synthesis is still an utterance on the device.
    base, path = blocking
    post(base, "/load", {"variant": "only"})
    abandon(base, {"text": "x", "stream": False})
    assert post(base, "/speak", {"text": "y", "stream": False}) == 200
    assert events(path) == ["load only", "speak begins", "speak ends", "speak begins", "speak ends"]
