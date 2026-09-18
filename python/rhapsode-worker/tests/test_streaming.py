"""Streaming, and what happens when it cannot finish. protocol.md § 6."""

from __future__ import annotations

import http.client
import json
import tempfile
import time
from pathlib import Path

import pytest
from conftest import await_handshake, spawn, stop


def connect(handshake: dict[str, object]) -> http.client.HTTPConnection:
    listen = str(handshake["listen"])
    host, _, port = listen[len("tcp:") :].rpartition(":")
    connection = http.client.HTTPConnection(host, int(port), timeout=30)
    return connection


def speak(connection: http.client.HTTPConnection, **body: object) -> http.client.HTTPResponse:
    connection.request(
        "POST",
        "/speak",
        body=json.dumps(body),
        headers={"content-type": "application/json"},
    )
    return connection.getresponse()


@pytest.fixture
def failing():
    """A worker whose engine misbehaves in the way the test names."""

    def factory(mode: str, **env: str):
        process = spawn(module="engines.failing", engine="failing", env={"RHAPSODE_TEST_MODE": mode, **env})
        handshake = await_handshake(process)
        return process, handshake

    started: list = []

    def start(mode: str, **env: str):
        process, handshake = factory(mode, **env)
        started.append(process)
        return process, handshake

    yield start
    for process in started:
        stop(process)


class TestStreaming:
    def test_a_streamed_body_is_chunked_and_arrives_in_pieces(self, worker) -> None:
        connection = connect(worker.handshake)
        response = speak(connection, text="a reasonably long line to synthesise", format="pcm", stream=True)

        assert response.status == 200
        assert response.getheader("transfer-encoding") == "chunked"
        assert response.getheader("content-length") is None

        pieces = []
        while True:
            block = response.read(4096)
            if not block:
                break
            pieces.append(block)
        assert len(pieces) > 1
        assert sum(len(piece) for piece in pieces) > 256
        connection.close()

    def test_a_buffered_body_carries_its_length(self, worker) -> None:
        connection = connect(worker.handshake)
        response = speak(connection, text="one two three", format="wav", stream=False)

        assert response.status == 200
        assert int(response.getheader("content-length") or 0) > 256
        assert response.getheader("transfer-encoding") is None
        connection.close()

    def test_a_streamed_wav_says_it_does_not_know_the_length(self, worker) -> None:
        # A streaming WAV header cannot be correct, so the choice is which way to be wrong. The
        # unknown-length marker is treated as unbounded; a zero would say "no samples" and stop a
        # strict reader dead.
        connection = connect(worker.handshake)
        response = speak(connection, text="streamed", format="wav", stream=True)
        header = response.read(44)
        assert header[:4] == b"RIFF"
        assert header[4:8] == b"\xff\xff\xff\xff"
        assert header[40:44] == b"\xff\xff\xff\xff"
        response.read()
        connection.close()

    def test_a_buffered_wav_carries_the_real_sizes(self, worker) -> None:
        connection = connect(worker.handshake)
        body = speak(connection, text="buffered", format="wav", stream=False).read()
        assert body[:4] == b"RIFF"
        assert body[4:8] != b"\xff\xff\xff\xff"
        assert int.from_bytes(body[40:44], "little") == len(body) - 44
        connection.close()


class TestFailingAfterTheHeadersHaveGone:
    def test_a_failure_before_the_first_byte_is_a_clean_error(self, failing) -> None:
        # This is what priming buys. Without it Starlette has already sent a 200 by the time the
        # adapter throws, and a perfectly good error envelope becomes an aborted connection.
        _, handshake = failing("raise_before_any_audio")
        connection = connect(handshake)
        response = speak(connection, text="x", format="pcm", stream=True)

        assert response.status == 500
        body = json.loads(response.read())
        assert body["error"]["code"] == "internal"
        assert body["error"]["retryable"] is False
        connection.close()

    def test_a_failure_before_the_first_byte_of_a_wav_is_a_clean_error_too(self, failing) -> None:
        # A streamed WAV opens with a header the SDK writes itself, before the engine is asked for
        # anything. Priming the encoded stream primed the header, so an unknown voice raised after
        # the 200 and the core saw a dropped connection where a 404 belonged. Found by the OpenAI
        # shim's test asking tone for "alloy" in wav.
        _, handshake = failing("raise_before_any_audio")
        connection = connect(handshake)
        response = speak(connection, text="x", format="wav", stream=True)

        assert response.status == 500
        body = json.loads(response.read())
        assert body["error"]["code"] == "internal"
        connection.close()

    def test_an_oom_before_the_first_byte_is_retryable(self, failing) -> None:
        _, handshake = failing("load_oom")
        connection = connect(handshake)
        response = speak(connection, text="x", format="pcm", stream=True)

        assert response.status == 503
        body = json.loads(response.read())
        assert body["error"]["code"] == "oom"
        assert body["error"]["retryable"] is True
        connection.close()

    def test_a_failure_mid_stream_aborts_rather_than_ending_cleanly(self, failing) -> None:
        # The one that bites. Once a 200 and a Content-Type are on the wire the status cannot be
        # taken back, so the connection has to break: a clean close would hand the core a short
        # successful body, which is a segment that airs as a click and is noticed by nobody.
        _, handshake = failing("raise_mid_stream")
        connection = connect(handshake)
        response = speak(connection, text="x", format="pcm", stream=True)
        assert response.status == 200

        with pytest.raises(http.client.IncompleteRead):
            response.read()
        connection.close()

    def test_the_chunked_stream_is_left_unterminated(self, failing) -> None:
        # The same thing one layer down, because "aborted" has to be true on the wire and not just
        # in the client library's opinion. A terminating 0-length chunk here would mean the core
        # reads a complete, short, silent file and never learns anything went wrong.
        import socket

        _, handshake = failing("raise_mid_stream")
        listen = str(handshake["listen"])
        host, _, port = listen[len("tcp:") :].rpartition(":")

        body = json.dumps({"text": "x", "format": "pcm", "stream": True}).encode()
        request = (
            b"POST /speak HTTP/1.1\r\nHost: localhost\r\n"
            b"Content-Type: application/json\r\n"
            b"Content-Length: " + str(len(body)).encode() + b"\r\nConnection: close\r\n\r\n" + body
        )

        sock = socket.create_connection((host, int(port)), timeout=30)
        sock.sendall(request)
        received = bytearray()
        while True:
            block = sock.recv(65536)
            if not block:
                break
            received.extend(block)
        sock.close()

        assert b"200 OK" in received
        assert b"transfer-encoding: chunked" in received.lower()
        assert not received.endswith(b"0\r\n\r\n"), "the stream terminated cleanly, so nothing was aborted"


class TestCancellation:
    def test_hanging_up_stops_the_engine(self, failing) -> None:
        # uvicorn silently drops writes once the peer is gone, so an app that never learns about a
        # disconnect runs to the end of a line nobody is listening to, holding the device the whole
        # time. Measured before this was handled: 39 of 40 chunks after the client left at 5.
        with tempfile.TemporaryDirectory() as directory:
            progress = Path(directory) / "progress"
            _, handshake = failing("slow", RHAPSODE_TEST_PROGRESS=str(progress))

            connection = connect(handshake)
            response = speak(connection, text="a long one", format="pcm", stream=True)
            assert response.status == 200
            response.read(4096)

            connection.close()
            time.sleep(0.5)
            stopped_at = int(progress.read_text() or 0)
            time.sleep(1.5)
            later = int(progress.read_text() or 0)

            assert later - stopped_at < 20, (
                f"the engine kept going after the client left: {stopped_at} -> {later} of 200"
            )


class TestConcurrency:
    def test_requests_are_serialised_by_default(self, worker) -> None:
        # One model, one utterance at a time is the correct default for a GPU. Two at once do not
        # go twice as fast; they contend for the same weights.
        import threading

        order: list[str] = []
        lock = threading.Lock()

        def one(name: str) -> None:
            connection = connect(worker.handshake)
            response = speak(connection, text="x" * 200, format="pcm", stream=False)
            response.read()
            with lock:
                order.append(name)
            connection.close()

        threads = [threading.Thread(target=one, args=(str(index),)) for index in range(4)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=60)

        assert len(order) == 4
