"""The engine-scoped subset of the public API, over HTTP. protocol.md § 1, § 4, § 6, § 7."""

from __future__ import annotations

import io
import json
import socket
import urllib.error
import urllib.request
import wave
from typing import Any

import h11
import pytest
from conftest import RunningWorker, await_handshake, spawn, stop, url_for


def get(worker: RunningWorker, path: str) -> Any:
    with urllib.request.urlopen(f"{worker.base_url}{path}", timeout=30) as response:
        return json.loads(response.read())


def post(worker: RunningWorker, path: str, body: dict[str, Any]) -> tuple[int, bytes, str]:
    request = urllib.request.Request(
        f"{worker.base_url}{path}",
        data=json.dumps(body).encode(),
        headers={"content-type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.status, response.read(), response.headers.get("content-type", "")
    except urllib.error.HTTPError as error:
        return error.code, error.read(), error.headers.get("content-type", "")


def failure(worker: RunningWorker, body: dict[str, Any]) -> tuple[int, dict[str, Any]]:
    status, raw, _ = post(worker, "/speak", body)
    return status, json.loads(raw)["error"]


class TestCapabilities:
    def test_current_is_absent_until_something_is_resident(self, worker: RunningWorker) -> None:
        # § 4 as amended: a worker in up(unloaded) has nothing to describe, and an invented answer
        # is worse than no answer.
        assert "current" not in get(worker, "/capabilities")

        post(worker, "/load", {"variant": "dialled"})
        current = get(worker, "/capabilities")["current"]
        assert current["variant"] == "dialled"
        assert current["nativeFormat"] == {"encoding": "pcm_s16le", "sampleRate": 24000, "channels": 1}

    def test_variants_describe_builds_that_differ(self, worker: RunningWorker) -> None:
        # The whole reason the document has two levels. An engine whose variants are identical
        # cannot demonstrate the problem it solves.
        variants = get(worker, "/capabilities")["variants"]
        assert variants["plain"]["cues"] and not variants["plain"]["dials"]
        assert variants["dialled"]["dials"] and not variants["dialled"]["cues"]

    def test_both_licences_are_named(self, worker: RunningWorker) -> None:
        # The weights licence is the one package metadata never reveals and the one that decides
        # whether a commercial user may ship.
        licence = get(worker, "/capabilities")["license"]
        assert set(licence) >= {"code", "weights", "weightsCommercialUse"}

    def test_formats_names_only_what_this_worker_can_produce(self, worker: RunningWorker) -> None:
        formats = get(worker, "/capabilities")["formats"]
        assert "wav" in formats and "pcm" in formats
        for name in formats:
            status, body, _ = post(worker, "/speak", {"text": "check", "format": name, "stream": False})
            assert status == 200, (name, body[:200])

    def test_cloning_is_derived_rather_than_declared(self, worker: RunningWorker) -> None:
        # An adapter that did not implement create_voice cannot advertise cloning, and one that did
        # cannot forget to. Nothing here is the adapter author's to remember.
        post(worker, "/load", {})
        assert get(worker, "/capabilities")["current"]["cloning"]["supported"] is True

        # And the other way: an engine with no create_voice says it does not clone.
        process = spawn(module="engines.failing", engine="failing", env={"RHAPSODE_TEST_MODE": "ok"})
        try:
            other = RunningWorker(
                process=process,
                handshake=(handshake := await_handshake(process)),
                base_url=url_for(handshake),
            )
            post(other, "/load", {})
            assert get(other, "/capabilities")["current"]["cloning"]["supported"] is False
        finally:
            stop(process)


class TestVoices:
    def test_a_voice_carries_an_opaque_spec_and_a_preview_url(self, worker: RunningWorker) -> None:
        voices = get(worker, "/voices")
        assert voices
        for voice in voices:
            assert voice["spec"]
            assert voice["previewUrl"] == f"/voices/{voice['id']}/preview"

    def test_the_spec_changes_when_the_rendering_would(self, worker: RunningWorker) -> None:
        # Keyed on the id instead, a remapped voice serves its old preview forever, because the id
        # is exactly the part that does not change when somebody edits what is under it.
        before = {voice["id"]: voice["spec"] for voice in get(worker, "/voices")}
        post(worker, "/load", {"variant": "dialled"})
        after = {voice["id"]: voice["spec"] for voice in get(worker, "/voices")}
        assert before.keys() == after.keys()
        assert all(before[key] != after[key] for key in before)


class TestSpeak:
    def test_it_loads_on_demand(self, worker: RunningWorker) -> None:
        # § 3: /speak does not fail with "no model loaded" and does not require /load first. The
        # alternative costs a round trip per utterance to ask a question the server already knows.
        assert get(worker, "/health")["model"] == "unloaded"
        status, body, _ = post(worker, "/speak", {"text": "one two three", "stream": False})
        assert status == 200 and len(body) > 256
        assert get(worker, "/health")["model"] == "loaded"

    def test_wav_is_framed_correctly_when_the_length_is_known(self, worker: RunningWorker) -> None:
        _, body, content_type = post(
            worker, "/speak", {"text": "a longer line here", "format": "wav", "stream": False}
        )
        assert content_type == "audio/wav"
        with wave.open(io.BytesIO(body)) as parsed:
            assert parsed.getnchannels() == 1
            assert parsed.getframerate() == 24000
            assert parsed.getnframes() > 0

    def test_pcm_carries_the_parameters_that_make_it_playable(self, worker: RunningWorker) -> None:
        # Raw PCM with no rate and no channel count is not playable by anything, so the Content-Type
        # parameters are the only description those bytes ever get.
        _, body, content_type = post(worker, "/speak", {"text": "hello", "format": "pcm", "stream": False})
        assert content_type == "audio/L16; rate=24000; channels=1"
        assert len(body) % 2 == 0

    def test_a_buffered_answer_says_how_long_it_is_in_bytes_and_in_time(self, worker: RunningWorker) -> None:
        # § 6: with `stream: false` the duration is known before the headers go out, so it is a
        # header. Nothing sent it until the core was checked against the spec, and a client that
        # needed the length of a take had to decode the take to find it.
        request = urllib.request.Request(
            f"{worker.base_url}/speak",
            data=json.dumps({"text": "one two three", "format": "pcm", "stream": False}).encode(),
            headers={"content-type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=60) as response:
            body = response.read()
            headers = response.headers

        assert int(headers["content-length"]) == len(body)
        # pcm is the native s16le at 24 kHz mono, so the body is the samples and nothing else.
        assert int(headers["x-rhapsode-duration-ms"]) == round(len(body) / 2 / 24_000 * 1000)

    def test_a_streamed_answer_says_how_long_it_was_in_a_trailer(self, worker: RunningWorker) -> None:
        # § 6: with `stream: true` the duration is not known until the audio has finished, so it is a
        # trailer. None of uvicorn's HTTP implementations send one, so the SDK serves on its own h11
        # protocol that does. h11 as the client too, because urllib and httpx both drop trailers.
        host, _, port = worker.base_url[len("http://") :].rpartition(":")
        body = json.dumps({"text": "one two three", "format": "pcm", "stream": True}).encode()
        client = h11.Connection(h11.CLIENT)
        with socket.create_connection((host, int(port)), timeout=60) as connection:
            connection.sendall(
                client.send(
                    h11.Request(
                        method="POST",
                        target="/speak",
                        headers=[
                            ("host", host),
                            ("content-type", "application/json"),
                            ("content-length", str(len(body))),
                            ("te", "trailers"),
                        ],
                    )
                )
                + client.send(h11.Data(data=body))
                + client.send(h11.EndOfMessage())
            )

            response: h11.Response | None = None
            audio = bytearray()
            trailers: dict[str, str] = {}
            while True:
                event = client.next_event()
                if event is h11.NEED_DATA:
                    client.receive_data(connection.recv(65536))
                elif isinstance(event, h11.Response):
                    response = event
                elif isinstance(event, h11.Data):
                    audio.extend(event.data)
                elif isinstance(event, h11.EndOfMessage):
                    trailers = {name.decode(): value.decode() for name, value in event.headers}
                    break

        assert response is not None and response.status_code == 200
        declared = {name.decode(): value.decode() for name, value in response.headers}
        assert declared["trailer"].lower() == "x-rhapsode-duration-ms"
        assert "content-length" not in declared
        # pcm is the native s16le at 24 kHz mono, so the body is the samples and nothing else.
        assert int(trailers["x-rhapsode-duration-ms"]) == round(len(audio) / 2 / 24_000 * 1000)

    def test_longer_text_makes_more_audio(self, worker: RunningWorker) -> None:
        _, short, _ = post(worker, "/speak", {"text": "one", "format": "pcm", "stream": False})
        _, long, _ = post(worker, "/speak", {"text": "one " * 40, "format": "pcm", "stream": False})
        assert len(long) > len(short)

    def test_a_seed_is_reproducible(self, worker: RunningWorker) -> None:
        body = {"text": "repeatable", "format": "pcm", "seed": 20260917, "stream": False}
        _, first, _ = post(worker, "/speak", body)
        _, second, _ = post(worker, "/speak", body)
        assert first == second


class TestTheErrorTaxonomy:
    def test_an_unknown_dial_names_the_key_and_what_the_variant_has(self, worker: RunningWorker) -> None:
        # Ignoring it is wrong for the same reason a silently discarded dial is wrong: the client
        # believes it asked for something. And a message that does not say what to send instead is
        # not a bug report delivered to the right person in under a second.
        status, error = failure(worker, {"text": "x", "variant": "dialled", "params": {"nope": 1}})
        assert (status, error["code"], error["retryable"]) == (400, "bad_request", False)
        assert '"nope"' in error["message"]
        assert "gain" in error["message"] and "pitch" in error["message"]

    def test_a_dial_out_of_range_is_refused(self, worker: RunningWorker) -> None:
        status, error = failure(worker, {"text": "x", "variant": "dialled", "params": {"pitch": 99}})
        assert (status, error["code"]) == (400, "bad_request")

    def test_a_variant_that_does_not_exist_is_refused_rather_than_swapped(
        self, worker: RunningWorker
    ) -> None:
        # Falling back to the default would produce audio the caller did not ask for and has no way
        # to notice, which is the failure this document spends its length arguing against.
        status, error = failure(worker, {"text": "x", "variant": "nosuch"})
        assert (status, error["code"]) == (422, "unsupported")

    def test_a_delivery_the_variant_does_not_claim_is_refused(self, worker: RunningWorker) -> None:
        status, error = failure(worker, {"text": "x", "variant": "plain", "delivery": "hushed"})
        assert (status, error["code"]) == (422, "unsupported")

    def test_a_format_outside_the_contract_is_refused(self, worker: RunningWorker) -> None:
        # True on every machine, whatever encoders it has, which is what the next test is not.
        status, error = failure(worker, {"text": "x", "format": "aiff"})
        assert (status, error["code"], error["retryable"]) == (422, "unsupported", False)
        assert "aiff" in error["message"]

    def test_a_format_this_worker_cannot_produce_says_why(self, worker: RunningWorker) -> None:
        # Which formats are missing is a fact about the machine, not about the code: this used to
        # ask for opus and assume it was absent, which held where it was written and failed on the
        # first CI runner that had ffmpeg. So it asks the worker what it has, and picks from what
        # the contract defines and the worker does not.
        produced = set(get(worker, "/capabilities")["formats"])
        missing = sorted({"mp3", "opus", "flac"} - produced)
        if not missing:
            pytest.skip("this machine's ffmpeg produces every format the contract defines")

        status, error = failure(worker, {"text": "x", "format": missing[0]})
        assert (status, error["code"], error["retryable"]) == (422, "unsupported", False)
        assert missing[0] in error["message"]

    def test_text_past_the_ceiling_is_refused(self, worker: RunningWorker) -> None:
        status, error = failure(worker, {"text": "x" * 99_999})
        assert (status, error["code"]) == (400, "bad_request")

    def test_every_envelope_carries_a_retryable_flag(self, worker: RunningWorker) -> None:
        # It is a field and not something a caller infers from the status, because a caller that
        # conflates "wrong request" with "server was busy" either retries forever or throws work
        # away that would have succeeded next time.
        for body in ({"text": ""}, {"text": "x", "format": "aiff"}, {"text": "x", "variant": "no"}):
            _, error = failure(worker, body)
            assert isinstance(error["retryable"], bool)
            assert set(error) == {"code", "message", "retryable"}


class TestResidency:
    def test_unloading_nothing_is_a_success(self, worker: RunningWorker) -> None:
        # Idempotent and never fatal, because the core unloads on a schedule it owns and cannot
        # know what a crash left behind.
        for _ in range(3):
            status, raw, _ = post(worker, "/unload", {})
            assert status == 200
            assert json.loads(raw)["model"] == "unloaded"

    def test_asking_for_another_variant_swaps_it(self, worker: RunningWorker) -> None:
        post(worker, "/load", {"variant": "plain"})
        assert get(worker, "/health")["variant"] == "plain"
        post(worker, "/speak", {"text": "x", "variant": "dialled", "stream": False})
        assert get(worker, "/health")["variant"] == "dialled"

    def test_health_answers_while_nothing_is_loaded(self, worker: RunningWorker) -> None:
        health = get(worker, "/health")
        assert health["process"] == "up"
        assert health["model"] == "unloaded"
