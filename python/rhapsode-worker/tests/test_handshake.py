"""Binding, the one line on stdout, and what happens when it cannot be printed. protocol.md § 2."""

from __future__ import annotations

import json

from conftest import RunningWorker, await_handshake, spawn, stop


def test_the_handshake_is_one_line_and_names_the_bound_port(worker: RunningWorker) -> None:
    assert worker.handshake["ready"] is True
    assert worker.handshake["engine"] == "tone"
    assert worker.handshake["contract"] == 1

    # tcp:127.0.0.1:0 asks the OS to choose, and the chosen port has to come back here or the core
    # has nothing to connect to. Reading it from getsockname() before listen() is what makes this
    # raceless; a poll loop is what it replaces.
    listen = str(worker.handshake["listen"])
    assert listen.startswith("tcp:127.0.0.1:")
    assert int(listen.rsplit(":", 1)[1]) > 0


def test_stdout_holds_the_handshake_and_nothing_else(worker: RunningWorker) -> None:
    # The seal is at the file descriptor as well as at sys.stdout, because adapters import torch and
    # torch imports runtimes that write to fd 1 in C. Anything arriving here corrupts the handshake
    # for a core that is still reading lines.
    stop(worker.process)
    assert worker.process.stdout is not None
    assert worker.process.stdout.read() == ""


def test_a_print_after_the_handshake_becomes_a_log_record() -> None:
    import urllib.request

    from conftest import url_for

    process = spawn(module="engines.noisy", engine="noisy")
    try:
        handshake = await_handshake(process)
        assert handshake["engine"] == "noisy"
        # The engine prints inside voices(), so something has to ask it for them.
        urllib.request.urlopen(f"{url_for(handshake)}/voices", timeout=10).read()
    finally:
        stop(process)

    assert process.stdout is not None
    assert process.stdout.read() == ""

    assert process.stderr is not None
    records = [json.loads(line) for line in process.stderr.read().splitlines() if line.startswith("{")]
    printed = [record for record in records if record.get("source") == "stdout"]
    assert any("a print that would have corrupted the handshake" in str(r.get("message")) for r in printed)


def test_an_engine_id_that_disagrees_with_the_core_refuses_to_start() -> None:
    # The core spawned this process believing it was something else, which means a misconfigured
    # catalog entry. Worth a loud failure now rather than a confusing 404 an hour later.
    process = spawn(engine="chatterbox")
    assert process.stdout is not None and process.stderr is not None
    process.wait(timeout=30)

    assert process.returncode != 0
    assert process.stdout.read() == ""
    failure = json.loads(process.stderr.read().strip())
    assert failure["code"] == "startup_failed"
    assert failure["message"] == 'the core spawned "chatterbox" and this engine is "tone"'


def test_a_contract_offer_below_what_we_speak_refuses_to_start() -> None:
    process = spawn(contract="0")
    assert process.stdout is not None and process.stderr is not None
    process.wait(timeout=30)

    assert process.returncode != 0
    assert process.stdout.read() == ""
    stderr = process.stderr.read()
    assert "the core offered 0" in stderr


def test_a_higher_offer_is_answered_at_our_own_maximum() -> None:
    # § 9: the core states a ceiling and the worker picks under it. A worker that echoed the offer
    # back would claim to speak a contract it has never seen.
    process = spawn(contract="7")
    try:
        handshake = await_handshake(process)
        assert handshake["contract"] == 1
    finally:
        stop(process)


def test_an_unparseable_listen_refuses_to_start() -> None:
    process = spawn(listen="carrier-pigeon:/dev/null")
    assert process.stdout is not None and process.stderr is not None
    process.wait(timeout=30)

    assert process.returncode != 0
    assert process.stdout.read() == ""
    assert "must start with unix: or tcp:" in process.stderr.read()


def test_sigterm_drains_and_exits_zero(worker: RunningWorker) -> None:
    assert stop(worker.process) == 0
