"""The suite, checked against a worker that is right and one that is wrong.

A conformance suite nothing has ever failed is decoration. These two tests are what make the rest of
it worth running.
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

REPO = Path(__file__).resolve().parents[3]
WORKER_TESTS = REPO / "python" / "rhapsode-worker" / "tests"


def _spawn(module: str, engine: str) -> Iterator[str]:
    process = subprocess.Popen(
        [sys.executable, "-m", module],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        cwd=REPO,
        env={
            **os.environ,
            "PYTHONPATH": os.pathsep.join(
                filter(None, [str(WORKER_TESTS), os.environ.get("PYTHONPATH", "")])
            ),
            "RHAPSODE_WORKER_LISTEN": "tcp:127.0.0.1:0",
            "RHAPSODE_WORKER_ENGINE": engine,
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
                raise RuntimeError(f"worker exited before the handshake:\n{process.stderr.read()}")
        yield str(json.loads(line)["listen"])
    finally:
        process.terminate()
        try:
            process.wait(timeout=15)
        except subprocess.TimeoutExpired:  # pragma: no cover
            process.kill()


@pytest.fixture
def tone() -> Iterator[str]:
    yield from _spawn("rhapsode_engine_tone", "tone")


@pytest.fixture
def dishonest() -> Iterator[str]:
    yield from _spawn("engines.dishonest", "dishonest")


@pytest.fixture
def unseeded() -> Iterator[str]:
    yield from _spawn("engines.unseeded", "unseeded")


def test_the_reference_engine_passes_everything(tone: str) -> None:
    with Worker(tone) as worker:
        report = run(worker)
    assert report.ok, [f"{f.name}: {f.detail}" for f in report.failures]
    assert len(report.results) > 15


def test_an_engine_that_claims_what_it_cannot_perform_fails(dishonest: str) -> None:
    # The one honesty requirement § 8 puts on an adapter, and the closest a machine can get to
    # checking it: a cue wired to nothing produces audio identical to the line without it.
    with Worker(dishonest) as worker:
        report = run(worker)

    assert not report.ok
    failed = {failure.name for failure in report.failures}
    assert any("cue" in name and "changes the audio" in name for name in failed), failed
    assert any("delivery" in name and "changes the audio" in name for name in failed), failed


def test_the_cli_exit_code_is_the_verdict(tone: str) -> None:
    # An engine author wires this into their own CI, so the exit code is the entire interface.
    result = subprocess.run(
        [sys.executable, "-m", "rhapsode_conform", tone, "--no-colour"],
        capture_output=True,
        text=True,
        timeout=300,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "speaks the contract" in result.stdout


def test_a_comparison_that_cannot_fail_is_not_reported_as_passed(unseeded: str) -> None:
    # A sampling model produces different audio on every call, so "the audio changed" is true
    # whether or not a cue was performed. This engine performs nothing, and without a seed held
    # fixed it used to pass both honesty checks. It must not pass them now.
    with Worker(unseeded) as worker:
        report = run(worker)

    honesty = [r for r in report.results if "changes the audio" in r.name]
    assert honesty, "the engine claims a cue and a delivery, so there should be checks for them"
    assert all(r.skipped and not r.passed for r in honesty), [(r.name, r.passed, r.skipped) for r in honesty]
    assert any(r.skipped and "seed reproduces" in r.name for r in report.results)


def test_undecided_checks_are_not_a_failure_unless_asked(unseeded: str) -> None:
    # Section 6 makes reproducibility optional, so an engine that cannot reproduce is not broken.
    # An operator who needs the honesty checks decided can ask for --strict.
    plain = subprocess.run(
        [sys.executable, "-m", "rhapsode_conform", unseeded, "--no-colour"],
        capture_output=True,
        text=True,
        timeout=300,
        check=False,
    )
    strict = subprocess.run(
        [sys.executable, "-m", "rhapsode_conform", unseeded, "--no-colour", "--strict"],
        capture_output=True,
        text=True,
        timeout=300,
        check=False,
    )

    assert plain.returncode == 0, plain.stdout
    assert "could not be decided" in plain.stdout
    assert strict.returncode == 1


def test_a_seeded_engine_has_its_honesty_checks_decided(tone: str) -> None:
    with Worker(tone) as worker:
        report = run(worker)

    honesty = [r for r in report.results if "changes the audio" in r.name]
    assert honesty and all(r.passed for r in honesty)
    assert not report.skipped
