"""The adapter against the suite an engine author is asked to run.

Everything under test is the real adapter and the real SDK, and the real download and verification
code. Only kokoro-onnx and eSpeak NG are stubbed, and the weights are a few bytes each. Whether the
voices sound right is a question for the real weights, and rhapsode-conform against a real install is
where it gets asked.
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
            "RHAPSODE_VOICE_DIR": str(tmp_path / "voices"),
            "RHAPSODE_KOKORO_WEIGHTS": str(tmp_path / "weights"),
            "RHAPSODE_WORKER_LISTEN": "tcp:127.0.0.1:0",
            "RHAPSODE_WORKER_ENGINE": "kokoro",
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


def test_a_voice_it_does_not_have_is_a_404_even_in_a_streamed_wav(stubbed: str) -> None:
    # A streamed WAV opens with a header the SDK writes before the engine is asked for anything, and
    # the voice is checked on the engine's first chunk. That was a 200 and a dropped connection until
    # the SDK primed the engine's audio rather than the encoded stream.
    with Worker(stubbed) as worker:
        status, body = worker.speak({"text": "x", "voice": "ff_siwis", "format": "wav", "stream": True})
        assert status == 404
        assert json.loads(body)["error"]["code"] == "unknown_voice"
