"""An adapter's unclassified exception is a 500 that leaves the connection usable. protocol.md § 6.

Starlette hands an `Exception` handler to its outermost middleware, which sends the handler's answer
and then raises again, and uvicorn closes the socket. So a plain ValueError out of an adapter
answered a correct `internal` 500 and the NEXT request on that keep-alive connection was reset:
found on 2026-09-19 as a conformance check that "raised: Connection reset by peer" after a Kokoro
blend failed. The core pools its connections to a worker, so any request can be the next one.
"""

from __future__ import annotations

from collections.abc import Iterator

import httpx
import pytest
from conftest import RunningWorker, await_handshake, spawn, stop, url_for


@pytest.fixture
def crashing() -> Iterator[RunningWorker]:
    process = spawn(module="engines.crashing", engine="crashing")
    handshake = await_handshake(process)
    try:
        yield RunningWorker(process=process, handshake=handshake, base_url=url_for(handshake))
    finally:
        stop(process)


#: The close races the next request, so a round can pass by luck. Measured before the fix: at three
#: rounds 2 of 12 runs still passed, at ten none of 12 did.
ROUNDS = 10


def test_a_failed_list_leaves_the_connection_for_the_next_request(crashing: RunningWorker) -> None:
    with httpx.Client(base_url=crashing.base_url, timeout=30) as client:
        for _ in range(ROUNDS):
            failed = client.get("/voices")
            assert failed.status_code == 500
            assert failed.json()["error"]["code"] == "internal"
            assert failed.json()["error"]["retryable"] is False

            # On the same connection. Before the fix this raised ReadError: Connection reset by peer.
            assert client.get("/health").status_code == 200


def test_a_failed_create_leaves_the_connection_for_the_next_request(crashing: RunningWorker) -> None:
    with httpx.Client(base_url=crashing.base_url, timeout=30) as client:
        for _ in range(ROUNDS):
            failed = client.post(
                "/voices", data={"id": "host"}, files={"reference": ("clip.wav", b"RIFF", "audio/wav")}
            )
            assert (failed.status_code, failed.json()["error"]["code"]) == (500, "internal")
            assert "ValueError" in failed.json()["error"]["message"]
            assert client.get("/health").status_code == 200


def test_the_failure_is_logged_as_the_adapter_raised_it(crashing: RunningWorker) -> None:
    with httpx.Client(base_url=crashing.base_url, timeout=30) as client:
        client.get("/voices")
    stop(crashing.process)
    logged = [line for line in crashing.stderr_lines() if line.get("message") == "request failed"]
    assert logged and "ValueError" in str(logged[0]), logged
