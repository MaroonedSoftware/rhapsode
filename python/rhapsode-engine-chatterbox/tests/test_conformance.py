"""The adapter against the suite an engine author is asked to run.

Everything under test is the real adapter and the real SDK. Only the three upstream classes are
stubbed, because the real ones bring torch and several gigabytes of weights, and no amount of
stubbing can tell you whether the turbo weights actually perform a laugh. What this does tell you is
that the adapter's protocol surface is right, which is the half that is this repository's to get
wrong.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from collections.abc import Iterator
from pathlib import Path

import pytest
from rhapsode_conform import Worker, run

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]


@pytest.fixture
def stubbed(tmp_path: Path) -> Iterator[str]:
    process = subprocess.Popen(
        [sys.executable, "-m", "harness.stubbed"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        cwd=REPO,
        env={
            **os.environ,
            "PYTHONPATH": os.pathsep.join(filter(None, [str(HERE), os.environ.get("PYTHONPATH", "")])),
            "RHAPSODE_VOICE_DIR": str(tmp_path),
            "RHAPSODE_WORKER_LISTEN": "tcp:127.0.0.1:0",
            "RHAPSODE_WORKER_ENGINE": "chatterbox",
            "RHAPSODE_WORKER_CONTRACT": "1",
        },
    )
    try:
        assert process.stdout is not None
        deadline = time.monotonic() + 30
        line = ""
        while time.monotonic() < deadline:
            line = process.stdout.readline()
            if line:
                break
            if process.poll() is not None:
                assert process.stderr is not None
                raise RuntimeError(f"the worker exited before its handshake:\n{process.stderr.read()}")
        yield str(json.loads(line)["listen"])
    finally:
        process.terminate()
        try:
            process.wait(timeout=15)
        except subprocess.TimeoutExpired:  # pragma: no cover
            process.kill()


def test_the_adapter_speaks_the_contract(stubbed: str) -> None:
    with Worker(stubbed) as worker:
        report = run(worker)

    assert report.ok, [f"{failure.name}: {failure.detail}" for failure in report.failures]
    assert len(report.results) > 25


def test_the_two_level_document_says_something_a_flat_one_could_not(stubbed: str) -> None:
    # The proposition the whole capability document exists to express, checked on the engine it was
    # designed around: you get cues or dials, never both, and which one is a fact about the weights
    # that are resident right now.
    with Worker(stubbed) as worker:
        _, capabilities = worker.get("/capabilities")

        turbo = capabilities["variants"]["turbo"]
        original = capabilities["variants"]["original"]
        assert turbo["cues"] and not turbo["dials"]
        assert original["dials"] and not original["cues"]

        # And `current` follows the weights, not the engine.
        worker.post("/load", {"variant": "turbo"})
        assert worker.get("/capabilities")[1]["current"]["cues"]
        assert not worker.get("/capabilities")[1]["current"]["dials"]

        worker.post("/load", {"variant": "original"})
        assert not worker.get("/capabilities")[1]["current"]["cues"]
        assert worker.get("/capabilities")[1]["current"]["dials"]


def test_a_dial_the_resident_build_cannot_perform_is_refused_rather_than_ignored(stubbed: str) -> None:
    # Upstream's turbo logs that exaggeration is unsupported and drops it. That silent discard is the
    # failure the capability document exists to prevent, and this is where prevention shows up.
    with Worker(stubbed) as worker:
        status, body = worker.speak(
            {"text": "x", "variant": "turbo", "params": {"exaggeration": 0.9}, "stream": False}
        )
        assert status == 400
        error = json.loads(body)["error"]
        assert error["code"] == "bad_request"
        assert "exaggeration" in error["message"]
