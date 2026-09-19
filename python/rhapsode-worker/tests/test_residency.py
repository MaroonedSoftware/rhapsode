"""Loading, unloading, terminating, and draining. protocol.md § 2 and § 3."""

from __future__ import annotations

import json
import signal
import time
import urllib.error
import urllib.request
from typing import Any

import pytest
from conftest import await_handshake, spawn, stop


def call(base: str, path: str, body: dict[str, Any] | None = None, method: str = "GET") -> tuple[int, bytes]:
    request = urllib.request.Request(
        f"{base}{path}",
        data=None if body is None else json.dumps(body).encode(),
        headers={} if body is None else {"content-type": "application/json"},
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


@pytest.fixture
def failing():
    started: list = []

    def start(mode: str, **env: str):
        process = spawn(module="engines.failing", engine="failing", env={"RHAPSODE_TEST_MODE": mode, **env})
        handshake = await_handshake(process)
        started.append(process)
        listen = str(handshake["listen"])
        host, _, port = listen[len("tcp:") :].rpartition(":")
        return process, f"http://{host}:{port}"

    yield start
    for process in started:
        stop(process)


class TestLoading:
    def test_a_load_that_strands_memory_is_retried_exactly_once(self, failing) -> None:
        # 3.5 GiB was measured stranded on a 16 GiB card by a load that died on OOM, so an
        # immediate retry throws itself at a card it just filled. Unload first, then try once.
        _, base = failing("load_oom_once")
        status, body = call(base, "/load", {}, method="POST")
        assert status == 200, body
        assert json.loads(body)["model"] == "loaded"

    def test_a_load_that_keeps_failing_gives_up_and_says_it_is_worth_retrying(self, failing) -> None:
        # Exactly once: a second failure is a fact about the card rather than about timing, and a
        # loop would hold the transition lock while the core waits to try something else.
        _, base = failing("load_oom")
        status, body = call(base, "/load", {}, method="POST")
        error = json.loads(body)["error"]
        assert (status, error["code"], error["retryable"]) == (503, "oom", True)

    def test_a_loader_that_throws_a_type_error_is_internal_and_not_the_callers_fault(self, failing) -> None:
        # The request named a variant and nothing else. A 400 here tells the client its request was
        # wrong, and a client that believes that drops a job that nothing it could change would fix.
        _, base = failing("load_type_error")
        status, body = call(base, "/load", {}, method="POST")
        error = json.loads(body)["error"]
        assert (status, error["code"]) == (500, "internal")

    def test_a_failed_load_leaves_the_worker_usable(self, failing) -> None:
        _, base = failing("load_oom")
        call(base, "/load", {}, method="POST")
        status, body = call(base, "/health")
        assert status == 200
        assert json.loads(body)["model"] == "unloaded"


class TestUnloading:
    def test_an_adapter_whose_unload_throws_does_not_strand_the_worker(self, failing) -> None:
        # The model is gone as far as anybody here is concerned, and refusing to move on would
        # leave the state machine stuck in `unloading` with no way out.
        _, base = failing("unload_throws")
        assert call(base, "/load", {}, method="POST")[0] == 200
        status, body = call(base, "/unload", {}, method="POST")
        assert status == 200
        assert json.loads(body)["model"] == "unloaded"


class TestTerminate:
    def test_it_answers_before_it_goes(self, failing) -> None:
        # The answer has to leave before the process does, so 202: the work is accepted, and the
        # evidence it happened is the socket closing.
        process, base = failing("ok")
        assert call(base, "/terminate", {}, method="POST")[0] == 202
        assert process.wait(timeout=30) == 0

    def test_it_is_what_reclaims_what_an_unload_cannot(self, failing) -> None:
        # An unload leaves roughly 30% behind because the graphics runtime holds it until the
        # process exits, which is the entire reason this verb exists next to the other one.
        process, base = failing("ok")
        call(base, "/load", {}, method="POST")
        call(base, "/terminate", {}, method="POST")
        assert process.wait(timeout=30) == 0


class TestDraining:
    def test_a_signal_that_arrives_while_exiting_does_not_kill_it(self) -> None:
        # § 2: SIGTERM means drain and exit 0. A second one used to land after uvicorn had put the
        # worker's handler back and while Python was finalizing, which resets a Python handler to
        # the default, so a worker that had drained correctly died of it with -15. The draining test
        # below sends two, and failed that way whenever the second arrived late enough.
        process = spawn()
        await_handshake(process)
        signals = 0
        while process.poll() is None and signals < 200:
            process.send_signal(signal.SIGTERM)
            signals += 1
            time.sleep(0.005)
        # communicate rather than wait, so stderr is read while it exits and a full pipe cannot be
        # what decides the outcome.
        process.communicate(timeout=10)
        assert process.returncode == 0, f"exited {process.returncode} after {signals} signals"

    def test_a_draining_worker_refuses_new_work_as_retryable(self, worker) -> None:
        # § 2 said 503 and the § 6 table said 429; the table wins. A request a draining worker
        # refused is one to send somewhere else or send again, not one to write off.
        worker.process.terminate()

        codes = set()
        for _ in range(40):
            try:
                status, body = call(worker.base_url, "/speak", {"text": "x", "stream": False}, method="POST")
            except (urllib.error.URLError, ConnectionError, OSError):
                break
            if status == 429:
                assert json.loads(body)["error"]["retryable"] is True
                codes.add(429)
                break
            codes.add(status)

        assert stop(worker.process) == 0
        # Either it refused us or it had already gone. Both are correct; what would not be is a
        # request accepted after the drain started.
        assert codes <= {200, 429}
