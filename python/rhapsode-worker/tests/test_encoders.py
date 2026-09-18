"""The worker with an encoder installed and without one, on any machine.

Without this the suite ran in exactly one ffmpeg state on a given machine, so a test written where
ffmpeg was absent could encode that absence as a fact and nothing local would notice. The first CI
run with a real ffmpeg is where it surfaced, and the reverse held too: on CI, where ffmpeg is
installed, nothing covered its absence. Both states are forced here rather than inherited.

`tests/fakes/ffmpeg` claims every encoder and copies its input through, which is enough to run the
"encoder installed" branch of the capability document and the pipeline. Whether real opus is valid
opus is still a question for CI's real ffmpeg.
"""

from __future__ import annotations

import json
import urllib.request
from collections.abc import Iterator
from pathlib import Path

import pytest
from conftest import await_handshake, spawn, stop, url_for

FAKE = Path(__file__).resolve().parent / "fakes" / "ffmpeg"


@pytest.fixture
def plain_worker() -> Iterator[str]:
    """A worker whose ffmpeg does not exist, which is a machine with no encoder installed."""
    process = spawn(env={"RHAPSODE_FFMPEG": "/nonexistent/rhapsode/ffmpeg"})
    try:
        yield url_for(await_handshake(process))
    finally:
        stop(process)


@pytest.fixture
def encoding_worker() -> Iterator[str]:
    process = spawn(env={"RHAPSODE_FFMPEG": str(FAKE)})
    try:
        yield url_for(await_handshake(process))
    finally:
        stop(process)


def speak(base: str, body: dict[str, object]) -> tuple[int, bytes, str]:
    request = urllib.request.Request(
        f"{base}/speak",
        data=json.dumps(body).encode(),
        headers={"content-type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.status, response.read(), response.headers.get("content-type", "")
    except urllib.error.HTTPError as error:
        return error.code, error.read(), error.headers.get("content-type", "")


def test_an_installed_encoder_is_advertised(encoding_worker: str) -> None:
    with urllib.request.urlopen(f"{encoding_worker}/capabilities", timeout=30) as response:
        formats = json.loads(response.read())["formats"]
    assert {"pcm", "wav", "mp3", "opus", "flac"} <= set(formats)


@pytest.mark.parametrize(
    ("name", "content_type"), [("mp3", "audio/mpeg"), ("opus", "audio/opus"), ("flac", "audio/flac")]
)
def test_every_advertised_format_goes_through_the_encoder(
    encoding_worker: str, name: str, content_type: str
) -> None:
    for stream in (True, False):
        status, body, received = speak(
            encoding_worker, {"text": "through the encoder", "format": name, "stream": stream}
        )
        assert status == 200, body[:200]
        assert received == content_type
        assert len(body) > 256


def test_the_error_envelope_still_parses_when_every_format_is_available(encoding_worker: str) -> None:
    # The two tests that failed on the first CI run with ffmpeg, restated where the answer is known.
    status, body, _ = speak(encoding_worker, {"text": "x", "format": "aiff"})
    assert status == 422
    assert json.loads(body)["error"]["code"] == "unsupported"


def test_without_an_encoder_only_the_self_framed_formats_are_advertised(plain_worker: str) -> None:
    # Never an empty list: pcm and wav are framed by the SDK itself, and a worker that can only do
    # those is still a useful worker.
    with urllib.request.urlopen(f"{plain_worker}/capabilities", timeout=30) as response:
        assert json.loads(response.read())["formats"] == ["pcm", "wav"]


@pytest.mark.parametrize("name", ["mp3", "opus", "flac"])
def test_without_an_encoder_a_codec_format_is_refused_and_says_why(plain_worker: str, name: str) -> None:
    # The message is the difference between "install ffmpeg" and "build one with libopus", which is
    # the whole reason it exists.
    status, body, _ = speak(plain_worker, {"text": "x", "format": name})
    error = json.loads(body)["error"]
    assert (status, error["code"], error["retryable"]) == (422, "unsupported", False)
    assert name in error["message"]
    assert "ffmpeg" in error["message"]
