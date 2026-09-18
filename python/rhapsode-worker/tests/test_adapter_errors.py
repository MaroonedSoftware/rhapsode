"""An adapter that throws is the adapter's fault, and the caller hears so as an answer. protocol.md § 6."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any

import pytest
from conftest import await_handshake, spawn, stop, url_for


def call(base: str, path: str, body: dict[str, Any] | None = None, method: str = "GET") -> tuple[int, Any]:
    request = urllib.request.Request(
        f"{base}{path}",
        data=None if body is None else json.dumps(body).encode(),
        headers={} if body is None else {"content-type": "application/json"},
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())


@pytest.fixture
def failing():
    started: list = []

    def start(mode: str) -> str:
        process = spawn(module="engines.failing", engine="failing", env={"RHAPSODE_TEST_MODE": mode})
        started.append(process)
        return url_for(await_handshake(process))

    yield start
    for process in started:
        stop(process)


class TestSpeakThatThrowsBeforeAudio:
    @pytest.mark.parametrize("mode", ["raise_before_any_audio", "type_error_before_any_audio"])
    def test_speak_answers_internal(self, failing, mode: str) -> None:
        # A TypeError out of upstream code was answering 400, which tells a client its request was
        # wrong. Measured on Chatterbox on Apple Silicon, cloning from a reference: a float64 tensor
        # the GPU cannot hold, reported as the caller's fault.
        status, body = call(failing(mode), "/speak", {"text": "hello", "stream": False}, method="POST")
        assert (status, body["error"]["code"]) == (500, "internal")

    @pytest.mark.parametrize("mode", ["raise_before_any_audio", "type_error_before_any_audio"])
    def test_a_preview_answers_rather_than_dropping_the_connection(self, failing, mode: str) -> None:
        # The same failure through a preview reset the connection, which a client cannot tell from
        # a crashed worker.
        status, body = call(failing(mode), "/voices/one/preview")
        assert (status, body["error"]["code"]) == (500, "internal")
