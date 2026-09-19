"""The adapter against the suite an engine author is asked to run.

Everything under test is the real adapter and the real SDK, served over a socket. Only torch,
transformers and the hub are fakes. No stub can say whether `(laughs)` is performed; what this says is
that the adapter's protocol surface is right, which is the half this repository can get wrong.
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
            "RHAPSODE_WORKER_ENGINE": "dia",
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


def test_every_cue_it_claims_changes_the_audio(stubbed: str) -> None:
    with Worker(stubbed) as worker:
        report = run(worker)

    cue_checks = [result for result in report.results if result.name.startswith("cue ")]
    assert len(cue_checks) == 8
    assert all(result.passed for result in cue_checks)
    # Every one decided, which only a seed that reproduces the audio allows.
    assert report.skipped == []


def test_an_unknown_voice_is_a_404_before_any_audio(stubbed: str) -> None:
    with Worker(stubbed) as worker:
        status, body = worker.speak({"text": "x", "voice": "narrator", "stream": False})
    assert status == 404
    assert json.loads(body)["error"]["code"] == "unknown_voice"


def test_its_dialogue_is_checked_and_passes(stubbed: str) -> None:
    with Worker(stubbed) as worker:
        report = run(worker)

    checks = [result for result in report.results if "dialogue" in result.name or "speakers" in result.name]
    assert {
        'a dialogue speaks on variant "1.6b"',
        'more than 2 speakers is refused as unsupported on variant "1.6b"',
    } <= {result.name for result in checks}
    assert all(result.passed for result in checks)
