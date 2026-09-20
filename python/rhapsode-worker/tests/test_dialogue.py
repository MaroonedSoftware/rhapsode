"""`/dialogue`: a conversation in one take, declared per variant. protocol.md § 4 and § 6."""

from __future__ import annotations

import io
import json
import urllib.error
import urllib.request
import wave
from collections.abc import Iterator
from typing import Any

import pytest
from conftest import RunningWorker, await_handshake, spawn, stop, url_for

TURNS = [
    {"speaker": "a", "text": "Did you hear that?"},
    {"speaker": "b", "text": "It is only the cat."},
    {"speaker": "a", "text": "It is never only the cat."},
]


def post(base: str, body: dict[str, Any]) -> tuple[int, bytes, dict[str, str]]:
    request = urllib.request.Request(
        f"{base}/dialogue",
        data=json.dumps(body).encode(),
        headers={"content-type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.status, response.read(), dict(response.headers)
    except urllib.error.HTTPError as error:
        return error.code, error.read(), dict(error.headers)


def refusal(base: str, body: dict[str, Any]) -> tuple[int, str, str]:
    status, raw, _ = post(base, body)
    error = json.loads(raw)["error"]
    return status, error["code"], error["message"]


def capabilities(base: str) -> dict[str, Any]:
    with urllib.request.urlopen(f"{base}/capabilities", timeout=30) as response:
        return dict(json.loads(response.read()))


def frames(wav: bytes) -> int:
    with wave.open(io.BytesIO(wav)) as audio:
        return audio.getnframes()


@pytest.fixture
def without() -> Iterator[str]:
    """An engine that does not override `dialogue`."""
    process = spawn(module="engines.unseeded", engine="unseeded")
    try:
        yield url_for(await_handshake(process))
    finally:
        stop(process)


class TestDeclared:
    def test_every_variant_of_an_engine_that_speaks_it_says_so(self, worker: RunningWorker) -> None:
        for variant in capabilities(worker.base_url)["variants"].values():
            assert variant["dialogue"] == {"maxSpeakers": 2}

    def test_an_engine_that_does_not_says_nothing(self, without: str) -> None:
        for variant in capabilities(without)["variants"].values():
            assert "dialogue" not in variant

    def test_and_answers_unsupported_rather_than_anything_else(self, without: str) -> None:
        status, code, _ = refusal(without, {"turns": TURNS})
        assert (status, code) == (422, "unsupported")


class TestSpeaking:
    def test_a_conversation_is_one_take(self, worker: RunningWorker) -> None:
        status, body, headers = post(worker.base_url, {"turns": TURNS, "stream": False})
        assert status == 200
        assert headers["content-type"].startswith("audio/wav")
        # Every turn is in it, which for a tone means every turn's length.
        assert frames(body) > frames(post(worker.base_url, {"turns": TURNS[:1], "stream": False})[1])
        assert int(headers["x-rhapsode-duration-ms"]) > 0

    def test_streams_like_speak(self, worker: RunningWorker) -> None:
        status, body, _ = post(worker.base_url, {"turns": TURNS, "stream": True})
        assert status == 200
        assert len(body) > 256

    def test_a_seed_reproduces_it(self, worker: RunningWorker) -> None:
        once = post(worker.base_url, {"turns": TURNS, "seed": 7, "stream": False})[1]
        again = post(worker.base_url, {"turns": TURNS, "seed": 7, "stream": False})[1]
        assert once == again

    def test_a_voiced_speaker_sounds_like_the_voice(self, worker: RunningWorker) -> None:
        plain = post(worker.base_url, {"turns": TURNS, "stream": False})[1]
        voiced = post(worker.base_url, {"turns": TURNS, "voices": {"a": "square"}, "stream": False})[1]
        assert plain != voiced

    def test_dials_are_checked_as_for_speak(self, worker: RunningWorker) -> None:
        status, code, message = refusal(
            worker.base_url, {"turns": TURNS, "variant": "plain", "params": {"pitch": 1.2}}
        )
        assert (status, code) == (400, "bad_request")
        assert "pitch" in message


class TestRefused:
    def test_no_turns(self, worker: RunningWorker) -> None:
        assert refusal(worker.base_url, {"turns": []})[:2] == (400, "bad_request")
        assert refusal(worker.base_url, {})[:2] == (400, "bad_request")

    def test_a_turn_without_a_speaker_or_words(self, worker: RunningWorker) -> None:
        assert refusal(worker.base_url, {"turns": [{"speaker": "", "text": "x"}]})[:2] == (400, "bad_request")
        assert refusal(worker.base_url, {"turns": [{"speaker": "a", "text": ""}]})[:2] == (400, "bad_request")

    def test_more_speakers_than_the_variant_takes_is_unsupported(self, worker: RunningWorker) -> None:
        crowd = [*TURNS, {"speaker": "c", "text": "May I come in?"}]
        status, code, message = refusal(worker.base_url, {"turns": crowd})
        assert (status, code) == (422, "unsupported")
        assert "3 speakers" in message

    def test_a_voice_for_a_speaker_with_no_turn(self, worker: RunningWorker) -> None:
        # Most likely a typo, which would otherwise read that speaker in a voice nobody chose.
        status, code, message = refusal(worker.base_url, {"turns": TURNS, "voices": {"A": "square"}})
        assert (status, code) == (400, "bad_request")
        assert '"A"' in message

    def test_a_voice_the_engine_does_not_have_is_unknown_not_substituted(self, worker: RunningWorker) -> None:
        assert refusal(worker.base_url, {"turns": TURNS, "voices": {"a": "nobody"}})[:2] == (
            404,
            "unknown_voice",
        )

    def test_a_voice_id_that_is_not_a_name(self, worker: RunningWorker) -> None:
        assert refusal(worker.base_url, {"turns": TURNS, "voices": {"a": "../x"}})[:2] == (400, "bad_request")

    def test_the_ceiling_is_the_sum_of_every_turn(self, worker: RunningWorker) -> None:
        # One take is one budget. Each turn is under the ceiling; together they are over it.
        half = "x" * 2100
        turns = [{"speaker": "a", "text": half}, {"speaker": "b", "text": half}]
        status, code, message = refusal(worker.base_url, {"turns": turns})
        assert (status, code) == (400, "bad_request")
        assert "4200" in message
