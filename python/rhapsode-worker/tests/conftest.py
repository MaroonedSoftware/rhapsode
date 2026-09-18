"""A real worker process, over a real socket, for the tests to talk to.

These are HTTP-level tests against a live worker rather than unit tests against the app object,
because the things most worth pinning are the ones an in-process test cannot see: what reaches
stdout, what happens to a connection that fails mid-body, and whether the process exits when told.
It also means the same assertions become the conformance suite later without being rewritten.
"""

from __future__ import annotations

import json
import os
import signal
import socket
import subprocess
import sys
import tempfile
import time
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]
TESTS = Path(__file__).resolve().parent
STARTUP_TIMEOUT_SECONDS = 30


@dataclass
class RunningWorker:
    process: subprocess.Popen[str]
    handshake: dict[str, object]
    base_url: str

    def stderr_lines(self) -> list[dict[str, object]]:
        assert self.process.stderr is not None
        lines = []
        for line in self.process.stderr.read().splitlines():
            try:
                lines.append(json.loads(line))
            except ValueError:
                lines.append({"raw": line})
        return lines


def spawn(
    *,
    engine: str = "tone",
    contract: str = "1",
    listen: str = "tcp:127.0.0.1:0",
    module: str = "rhapsode_engine_tone",
    env: dict[str, str] | None = None,
) -> subprocess.Popen[str]:
    environment = {
        **os.environ,
        # So that the deliberately misbehaving engines under tests/engines/ are importable by a
        # spawned process without making tests/ a package, which would change how pytest collects.
        "PYTHONPATH": os.pathsep.join(filter(None, [str(TESTS), os.environ.get("PYTHONPATH", "")])),
        "RHAPSODE_WORKER_LISTEN": listen,
        "RHAPSODE_WORKER_ENGINE": engine,
        "RHAPSODE_WORKER_CONTRACT": contract,
        # Its own, so a voice a test creates lands nowhere near the repository, where the worker's
        # default (./voices/<engine> from cwd) would otherwise put it.
        "RHAPSODE_VOICE_DIR": tempfile.mkdtemp(prefix="rh-voices-"),
        **(env or {}),
    }
    return subprocess.Popen(
        [sys.executable, "-m", module],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=environment,
        cwd=REPO,
    )


def await_handshake(process: subprocess.Popen[str]) -> dict[str, object]:
    """Read the one line, or explain why there will never be one.

    A worker that exits before printing has failed to start and its stderr is the error message,
    which is the rule that makes a dead worker distinguishable from a slow one without a poll loop.
    """
    assert process.stdout is not None
    deadline = time.monotonic() + STARTUP_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        line = process.stdout.readline()
        if line:
            return json.loads(line)
        if process.poll() is not None:
            assert process.stderr is not None
            raise RuntimeError(
                f"worker exited {process.returncode} before the handshake:\n{process.stderr.read()}"
            )
        time.sleep(0.01)
    raise RuntimeError("no handshake within the startup budget")


def url_for(handshake: dict[str, object]) -> str:
    listen = str(handshake["listen"])
    assert listen.startswith("tcp:"), listen
    host, _, port = listen[len("tcp:") :].rpartition(":")
    return f"http://{host}:{port}"


def stop(process: subprocess.Popen[str], *, signum: int = signal.SIGTERM, timeout: float = 10.0) -> int:
    if process.poll() is None:
        process.send_signal(signum)
    try:
        process.wait(timeout=timeout)
    except subprocess.TimeoutExpired:  # pragma: no cover - only if drain is broken
        process.kill()
        process.wait(timeout=5)
    return process.returncode


@pytest.fixture
def worker() -> Iterator[RunningWorker]:
    process = spawn()
    try:
        handshake = await_handshake(process)
        yield RunningWorker(process=process, handshake=handshake, base_url=url_for(handshake))
    finally:
        stop(process)


@pytest.fixture
def raw_socket() -> Iterator[socket.socket]:
    """A socket the test drives by hand, for the things an HTTP client hides."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(20)
    try:
        yield sock
    finally:
        sock.close()
