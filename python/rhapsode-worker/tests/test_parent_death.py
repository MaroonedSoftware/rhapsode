"""A worker whose core is gone leaves on its own. protocol.md § 2, "When the core is gone".

A core that dies without stopping its children (a crash, an OOM kill, a test runner that never
closed it) leaves them reparented to init and holding their models. Nothing else will ever signal
them: 1,010 tone workers had piled up on one Mac by 2026-10-07, about 9.5 GB resident.
"""

from __future__ import annotations

import os
import signal
import subprocess
import sys
import tempfile
import time

from conftest import REPO, TESTS

#: Spawns the worker the way a core does, with its stdio piped back, and waits on the handshake so
#: the worker is past the point where its watch starts. Then it says which pid it started.
CORE = """
import subprocess, sys, time
worker = subprocess.Popen(
    [sys.executable, "-m", "rhapsode_engine_tone"],
    stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
)
worker.stdout.readline()
print(worker.pid, flush=True)
time.sleep(600)
"""


def alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    return True


def test_a_worker_exits_when_the_core_that_spawned_it_is_killed() -> None:
    environment = {
        **os.environ,
        "PYTHONPATH": os.pathsep.join(filter(None, [str(TESTS), os.environ.get("PYTHONPATH", "")])),
        "RHAPSODE_WORKER_LISTEN": "tcp:127.0.0.1:0",
        "RHAPSODE_WORKER_ENGINE": "tone",
        "RHAPSODE_WORKER_CONTRACT": "1",
        "RHAPSODE_VOICE_DIR": tempfile.mkdtemp(prefix="rh-voices-"),
    }
    core = subprocess.Popen(
        [sys.executable, "-c", CORE], stdout=subprocess.PIPE, text=True, env=environment, cwd=REPO
    )
    worker = 0
    try:
        assert core.stdout is not None
        worker = int(core.stdout.readline())
        assert alive(worker)

        # SIGKILL, because that is the death with no chance to clean up: no handler runs, and
        # nothing the core meant to do on its way out happens.
        core.send_signal(signal.SIGKILL)
        core.wait(timeout=10)

        deadline = time.monotonic() + 15
        while alive(worker) and time.monotonic() < deadline:
            time.sleep(0.1)
        assert not alive(worker), "the worker outlived the core that spawned it"
    finally:
        if core.poll() is None:
            core.kill()
            core.wait(timeout=5)
        if worker and alive(worker):
            os.kill(worker, signal.SIGKILL)
