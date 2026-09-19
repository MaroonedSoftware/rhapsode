"""Creating a voice from a blend or a reference, over HTTP. protocol.md § 7."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any

from conftest import RunningWorker, await_handshake, spawn, stop, url_for

BOUNDARY = "rhapsodeboundary"


def create(
    worker: RunningWorker, fields: dict[str, str], file: tuple[str, bytes] | None = None
) -> tuple[int, Any]:
    parts = [
        f'--{BOUNDARY}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode()
        for name, value in fields.items()
    ]
    if file is not None:
        filename, data = file
        parts.append(
            f'--{BOUNDARY}\r\nContent-Disposition: form-data; name="reference"; filename="{filename}"\r\n'
            "Content-Type: application/octet-stream\r\n\r\n".encode()
            + data
            + b"\r\n"
        )
    request = urllib.request.Request(
        f"{worker.base_url}/voices",
        data=b"".join(parts) + f"--{BOUNDARY}--\r\n".encode(),
        headers={"content-type": f"multipart/form-data; boundary={BOUNDARY}"},
        method="POST",
    )
    return _send(request)


def call(
    worker: RunningWorker, path: str, method: str = "GET", body: dict[str, Any] | None = None
) -> tuple[int, Any]:
    request = urllib.request.Request(
        f"{worker.base_url}{path}",
        data=None if body is None else json.dumps(body).encode(),
        headers={"content-type": "application/json"},
        method=method,
    )
    return _send(request)


def _send(request: urllib.request.Request) -> tuple[int, Any]:
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read()
            is_json = response.headers.get("content-type", "").startswith("application/json")
            return response.status, json.loads(raw) if is_json else raw
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())


def listed(worker: RunningWorker, voice_id: str) -> dict[str, Any] | None:
    _, voices = call(worker, "/voices")
    return next((voice for voice in voices if voice["id"] == voice_id), None)


def running(module: str, engine: str) -> RunningWorker:
    process = spawn(module=module, engine=engine)
    handshake = await_handshake(process)
    return RunningWorker(process=process, handshake=handshake, base_url=url_for(handshake))


class TestBlending:
    def test_a_blend_is_a_voice_like_any_other(self, worker: RunningWorker) -> None:
        status, created = create(worker, {"id": "host", "label": "Host", "blend": "sine(2)+square(1)"})
        assert status == 201, created
        assert created["label"] == "Host" and "blended" in created["tags"]
        assert listed(worker, "host") is not None

        status, audio = call(
            worker, "/speak", "POST", {"text": "In a mix.", "voice": "host", "stream": False}
        )
        assert status == 200 and len(audio) > 256

        status, _ = call(worker, "/voices/host", "DELETE")
        assert status == 204
        assert listed(worker, "host") is None

    def test_its_spec_follows_the_mix(self, worker: RunningWorker) -> None:
        # A client keys a cached preview on spec, so re-mixing a voice under the same id has to mint
        # a new one or the old preview plays forever.
        _, first = create(worker, {"id": "host", "blend": "sine(2)+square(1)"})
        _, second = create(worker, {"id": "host", "blend": "sine(1)+square(2)"})
        assert first["spec"] != second["spec"]

    def test_it_is_resolved_when_made_so_its_parts_can_change_under_it(self, worker: RunningWorker) -> None:
        create(worker, {"id": "part", "blend": "sine"})
        _, made = create(worker, {"id": "mix", "blend": "part+square"})
        call(worker, "/voices/part", "DELETE")
        assert listed(worker, "mix") == made
        status, _ = call(worker, "/speak", "POST", {"text": "Still me.", "voice": "mix", "stream": False})
        assert status == 200

    def test_a_blend_may_replace_a_clone_and_leaves_one_voice(self, worker: RunningWorker) -> None:
        create(worker, {"id": "host"}, ("clip.wav", b"RIFF"))
        create(worker, {"id": "host", "blend": "sine"})
        _, voices = call(worker, "/voices")
        assert [voice["tags"] for voice in voices if voice["id"] == "host"] == [["blended"]]

    def test_a_part_the_engine_lacks_is_unknown_voice(self, worker: RunningWorker) -> None:
        status, error = create(worker, {"id": "host", "blend": "sine+nobody"})
        assert (status, error["error"]["code"]) == (404, "unknown_voice")

    def test_a_malformed_recipe_is_bad_request(self, worker: RunningWorker) -> None:
        status, error = create(worker, {"id": "host", "blend": "sine(0)"})
        assert (status, error["error"]["code"]) == (400, "bad_request")

    def test_the_capability_document_says_it_blends(self, worker: RunningWorker) -> None:
        call(worker, "/load", "POST", {})
        assert call(worker, "/capabilities")[1]["current"]["blending"] == {"supported": True}

    def test_every_variant_says_it_blends_while_nothing_is_loaded(self, worker: RunningWorker) -> None:
        # A blend needs no model, so the answer cannot wait on one being resident. § 4.
        document = call(worker, "/capabilities")[1]
        assert "current" not in document
        assert all(variant["blending"] == {"supported": True} for variant in document["variants"].values())

    def test_an_engine_that_does_not_blend_says_so_and_refuses_one(self) -> None:
        # Refused as unsupported before the recipe is read: a syntax error in a recipe the engine
        # would never have used would send the caller to fix the wrong thing.
        other = running("engines.unseeded", "unseeded")
        try:
            call(other, "/load", "POST", {})
            assert call(other, "/capabilities")[1]["current"]["blending"] == {"supported": False}
            status, error = create(other, {"id": "host", "blend": "not a recipe ("})
            assert (status, error["error"]["code"]) == (422, "unsupported")
        finally:
            stop(other.process)


class TestExactlyOne:
    def test_both_is_refused(self, worker: RunningWorker) -> None:
        status, error = create(worker, {"id": "host", "blend": "sine"}, ("clip.wav", b"RIFF"))
        assert (status, error["error"]["code"]) == (400, "bad_request")
        assert "not both" in error["error"]["message"]

    def test_neither_is_refused(self, worker: RunningWorker) -> None:
        status, error = create(worker, {"id": "host"})
        assert (status, error["error"]["code"]) == (400, "bad_request")

    def test_the_id_rule_holds_for_a_blend(self, worker: RunningWorker) -> None:
        status, error = create(worker, {"id": "../../x", "blend": "sine"})
        assert (status, error["error"]["code"]) == (400, "bad_request")


class TestReferenceTypes:
    def test_a_type_the_engine_did_not_declare_is_unsupported(self) -> None:
        picky = running("engines.picky", "picky")
        try:
            call(picky, "/load", "POST", {})
            assert call(picky, "/capabilities")[1]["current"]["cloning"]["formats"] == ["npy"]

            status, error = create(picky, {"id": "host"}, ("clip.wav", b"RIFF"))
            assert (status, error["error"]["code"]) == (422, "unsupported")
            assert "npy" in error["error"]["message"]

            status, _ = create(picky, {"id": "host"}, ("style.NPY", b"\x93NUMPY"))
            assert status == 201
        finally:
            stop(picky.process)

    def test_an_engine_that_declares_none_takes_any(self, worker: RunningWorker) -> None:
        call(worker, "/load", "POST", {})
        assert "formats" not in call(worker, "/capabilities")[1]["current"]["cloning"]
        status, _ = create(worker, {"id": "host"}, ("anything.bin", b"data"))
        assert status == 201
