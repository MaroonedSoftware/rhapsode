"""Voice ids are names, and nothing an adapter turns into a path can be anything else. protocol.md § 7."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from conftest import RunningWorker, await_handshake, spawn, stop, url_for

from rhapsode_worker import BadRequest
from rhapsode_worker.engine import Engine, check_voice_id


def call(
    worker: RunningWorker,
    path: str,
    *,
    method: str,
    body: bytes | None = None,
    headers: dict[str, str] | None = None,
) -> tuple[int, Any]:
    request = urllib.request.Request(
        f"{worker.base_url}{path}", data=body, headers=headers or {}, method=method
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())


def multipart(
    voice_id: str, label: str | None = None, transcript: str | None = None
) -> tuple[bytes, dict[str, str]]:
    boundary = "rhapsodeboundary"
    fields = "".join(
        f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'
        for name, value in (("label", label), ("transcript", transcript))
        if value is not None
    )
    body = (
        fields + f'--{boundary}\r\nContent-Disposition: form-data; name="id"\r\n\r\n{voice_id}\r\n'
        f'--{boundary}\r\nContent-Disposition: form-data; name="reference"; filename="clip.wav"\r\n'
        "Content-Type: audio/wav\r\n\r\nRIFF\r\n"
        f"--{boundary}--\r\n"
    ).encode()
    return body, {"content-type": f"multipart/form-data; boundary={boundary}"}


class TestTheGrammar:
    @pytest.mark.parametrize("voice", ["narrator", "narrator_02", "N-3", "a", "x" * 64])
    def test_admits_a_name(self, voice: str) -> None:
        assert check_voice_id(voice) == voice

    @pytest.mark.parametrize(
        "voice",
        ["../../x", "*", "a*", "[ab]", "", ".hidden", "-x", "_x", "a b", "x" * 65, "a/b", "a\\\\b", "é"],
    )
    def test_refuses_anything_else(self, voice: str) -> None:
        with pytest.raises(BadRequest, match="is not a name"):
            check_voice_id(voice)


class TestOverHttp:
    def test_a_clone_named_as_a_path_is_refused_before_the_adapter_sees_it(
        self, worker: RunningWorker
    ) -> None:
        # Before this, the Chatterbox adapter wrote the upload to voice_dir / "../../x.wav".
        body, headers = multipart("../../x")
        status, error = call(worker, "/voices", method="POST", body=body, headers=headers)
        assert status == 400
        assert "is not a name" in error["error"]["message"]

    def test_a_delete_of_a_pattern_is_refused(self, worker: RunningWorker) -> None:
        # Before this, `*` globbed to whichever voice sorted first.
        status, error = call(worker, "/voices/%2A", method="DELETE")
        assert (status, error["error"]["code"]) == (400, "bad_request")

    def test_a_speak_naming_a_path_is_refused(self, worker: RunningWorker) -> None:
        body = json.dumps({"text": "hello", "voice": "../../etc/passwd"}).encode()
        status, error = call(
            worker, "/speak", method="POST", body=body, headers={"content-type": "application/json"}
        )
        assert (status, error["error"]["code"]) == (400, "bad_request")


class TestPathFor:
    def engine(self, tmp_path: Path) -> Engine:
        built = Engine()
        built.voice_dir = tmp_path
        return built

    def test_matches_the_stem_exactly_and_nothing_like_it(self, tmp_path: Path) -> None:
        (tmp_path / "narrator.wav").write_bytes(b"RIFF")
        (tmp_path / "narrator_02.wav").write_bytes(b"RIFF")
        assert self.engine(tmp_path).path_for("narrator").name == "narrator.wav"
        assert self.engine(tmp_path).path_for("narrator_02").name == "narrator_02.wav"

    def test_does_not_follow_a_link_out_of_the_voice_directory(self, tmp_path: Path) -> None:
        outside = tmp_path.parent / f"{tmp_path.name}-outside.wav"
        outside.write_bytes(b"RIFF")
        (tmp_path / "escape.wav").symlink_to(outside)
        with pytest.raises(Exception, match='no voice "escape"'):
            self.engine(tmp_path).path_for("escape")


class TestLabels:
    def test_a_clone_keeps_the_label_it_was_given(self, worker: RunningWorker) -> None:
        # Both adapters rebuilt a label from the file name, so "The Announcer" came back as
        # "Announcer" the moment anything listed it.
        body, headers = multipart("announcer", label="The Announcer")
        status, created = call(worker, "/voices", method="POST", body=body, headers=headers)
        assert status == 201
        assert json.loads(created)["label"] == "The Announcer"

        _, listed = call(worker, "/voices", method="GET")
        assert (
            next(voice for voice in json.loads(listed) if voice["id"] == "announcer")["label"]
            == "The Announcer"
        )

        assert call(worker, "/voices/announcer", method="DELETE")[0] == 204
        body, headers = multipart("announcer")
        _, recreated = call(worker, "/voices", method="POST", body=body, headers=headers)
        # Deleting forgets the label, so the same id recreated without one is not named after the old.
        assert json.loads(recreated)["label"] != "The Announcer"


class TestTranscripts:
    """The words spoken in a reference, for an engine that clones by continuing from it. § 7."""

    @pytest.fixture
    def transcribed(self) -> Iterator[str]:
        process = spawn(module="engines.transcribed", engine="transcribed")
        try:
            yield url_for(await_handshake(process))
        finally:
            stop(process)

    @staticmethod
    def create(base: str, transcript: str | None) -> tuple[int, Any]:
        body, headers = multipart("narrator", transcript=transcript)
        request = urllib.request.Request(f"{base}/voices", data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read())

    def test_reaches_the_adapter_as_it_was_written(self, transcribed: str) -> None:
        status, created = self.create(transcribed, "Hello, this is me.")
        assert (status, created["description"]) == (201, "Hello, this is me.")

    def test_absent_is_absent(self, transcribed: str) -> None:
        status, body = self.create(transcribed, None)
        assert (status, body["error"]["code"]) == (400, "bad_request")
        assert "transcript" in body["error"]["message"]

    def test_blank_is_absent_too(self, transcribed: str) -> None:
        # A form field left empty arrives as "". An engine that needs the words must be able to tell.
        status, body = self.create(transcribed, "   ")
        assert (status, body["error"]["code"]) == (400, "bad_request")

    def test_an_engine_that_does_not_read_it_ignores_it(self, worker: RunningWorker) -> None:
        body, headers = multipart("announcer", transcript="Whatever it said.")
        status, _ = call(worker, "/voices", method="POST", body=body, headers=headers)
        assert status == 201
        assert call(worker, "/voices/announcer", method="DELETE")[0] == 204
