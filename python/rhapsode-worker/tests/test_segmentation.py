"""The SDK splitting long text, so that `speak()` says one thing. protocol.md § 8."""

from __future__ import annotations

import json
import tempfile
import urllib.request
from pathlib import Path

import pytest
from conftest import await_handshake, spawn, stop
from engines.segmented import BYTES_PER_PIECE, SEGMENT_CHARACTERS

#: 50 ms at 24 kHz mono, as `SegmentedEngine` declares it.
PAUSE_BYTES = 2400

TEXT = " ".join(f"Sentence number {index} says something." for index in range(12))


def post(base_url: str, path: str, body: dict[str, object]) -> tuple[int, bytes]:
    request = urllib.request.Request(
        base_url + path,
        data=json.dumps(body).encode(),
        headers={"content-type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.status, response.read()


def get(base_url: str, path: str) -> dict:
    with urllib.request.urlopen(base_url + path, timeout=30) as response:
        return json.loads(response.read())


@pytest.fixture
def segmented():
    """A worker whose engine splits nothing itself and records what it was handed."""
    with tempfile.TemporaryDirectory() as directory:
        record = Path(directory) / "pieces.jsonl"
        process = spawn(
            module="engines.segmented",
            engine="segmented",
            env={"RHAPSODE_TEST_RECORD": str(record)},
        )
        handshake = await_handshake(process)
        base_url = f"http://{str(handshake['listen'])[len('tcp:') :]}"
        post(base_url, "/load", {"variant": "only"})
        try:
            yield base_url, record
        finally:
            stop(process)


def pieces(record: Path) -> list[dict]:
    return [json.loads(line) for line in record.read_text().splitlines()]


def test_speak_is_called_once_per_piece(segmented):
    base_url, record = segmented
    status, _ = post(base_url, "/speak", {"text": TEXT, "format": "pcm", "stream": False})
    assert status == 200

    handed = pieces(record)
    assert len(handed) > 1
    assert all(len(piece["text"]) <= SEGMENT_CHARACTERS for piece in handed)


def test_nothing_is_lost_across_the_joint(segmented):
    base_url, record = segmented
    post(base_url, "/speak", {"text": TEXT, "format": "pcm", "stream": False})
    assert " ".join(piece["text"] for piece in pieces(record)) == TEXT


def test_the_pieces_are_joined_with_the_declared_pause(segmented):
    """One take, not several responses: the audio is every piece plus the silence between them."""
    base_url, record = segmented
    _, audio = post(base_url, "/speak", {"text": TEXT, "format": "pcm", "stream": False})
    count = len(pieces(record))
    assert len(audio) == count * BYTES_PER_PIECE + (count - 1) * PAUSE_BYTES


def test_each_piece_is_seeded_from_the_requests_seed(segmented):
    """One seed for every piece would make each piece the same draw. protocol.md § 8."""
    base_url, record = segmented
    post(base_url, "/speak", {"text": TEXT, "format": "pcm", "stream": False, "seed": 20260917})
    assert [piece["seed"] for piece in pieces(record)] == [
        20260917 + index for index in range(len(pieces(record)))
    ]


def test_an_unseeded_request_hands_every_piece_no_seed(segmented):
    base_url, record = segmented
    post(base_url, "/speak", {"text": TEXT, "format": "pcm", "stream": False})
    assert all(piece["seed"] is None for piece in pieces(record))


def test_text_within_one_piece_is_one_call(segmented):
    """The split costs nothing on a request that never needed it."""
    base_url, record = segmented
    post(base_url, "/speak", {"text": "Short enough.", "format": "pcm", "stream": False})
    assert [piece["text"] for piece in pieces(record)] == ["Short enough."]


def test_the_capability_document_declares_the_split(segmented):
    base_url, _ = segmented
    capabilities = get(base_url, "/capabilities")
    declared = {"supported": True, "segmentCharacters": SEGMENT_CHARACTERS}
    assert capabilities["current"]["segmentation"] == declared
    # On every variant as well, so an idle engine is not mistaken for one that cannot split.
    assert capabilities["variants"]["only"]["segmentation"] == declared


def test_an_engine_that_does_not_split_says_so():
    """`tone` declares a split, so the negative case needs an engine that declares none."""
    process = spawn(module="engines.unseeded", engine="unseeded")
    handshake = await_handshake(process)
    base_url = f"http://{str(handshake['listen'])[len('tcp:') :]}"
    try:
        assert get(base_url, "/capabilities")["variants"]["only"]["segmentation"] == {"supported": False}
    finally:
        stop(process)
