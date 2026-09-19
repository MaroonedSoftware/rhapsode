"""`serve(MyEngine())`. The last line of an adapter, and the first thing that runs."""

from __future__ import annotations

import contextlib
import os
import signal
import socket
import sys
from pathlib import Path
from typing import Any

from .app import create_app
from .engine import Engine, detect_device
from .listen import StartupError, announce, bind, negotiate_contract, parse_listen, seal_stdout
from .log import Log
from .worker import Worker


def serve(engine: Engine, *, argv: list[str] | None = None) -> None:
    """Bind, announce, and answer until told to stop.

    Everything before the handshake can fail, and when it does the process exits non-zero having
    printed nothing to stdout. That is the contract § 2 relies on: a worker that exits before
    printing the line has failed to start, and its stderr is the error message. It is also what
    closes the failure where a worker that died on an import error is indistinguishable from one
    that is slow, and the operator waits two minutes to find out.
    """
    del argv  # reserved; the contract is environment variables and nothing else

    log = Log(engine=engine.id or "unknown", level=os.environ.get("RHAPSODE_LOG_LEVEL", "info"))
    try:
        listen, contract, sock = _prepare(engine)
    except StartupError as error:
        log.error(str(error), code="startup_failed")
        raise SystemExit(1) from error
    except Exception as error:
        log.error(f"failed to start: {error}", code="startup_failed", error=error)
        raise SystemExit(1) from error

    worker = Worker(engine=engine, contract=contract, log=log)

    # The server and its signal handlers exist BEFORE the handshake goes out, because the handshake
    # is a promise that this process is ready, and a process that would die on the default SIGTERM
    # disposition is not. The core is entitled to send a signal the instant it reads the line, and
    # the window between "announced" and "able to drain" has to be zero rather than merely short.
    server = _server(create_app(worker))
    _install_signal_handlers(server, worker, log)
    # POST /terminate is the same drain a signal asks for, reached over HTTP. The worker holds a
    # callback rather than the server, so nothing below the transport layer knows what uvicorn is.
    worker.stop = lambda: setattr(server, "should_exit", True)

    announce(engine=engine.id, contract=contract, listen=listen)
    seal_stdout(log)
    log.info("ready", listen=listen, contract=contract)

    # The path is captured here rather than read back from the socket at shutdown, because uvicorn
    # closes the sockets it was handed and getsockname() on a closed descriptor raises. Asking the
    # dead socket where it used to live is how the file gets left behind for the next worker to
    # trip over.
    socket_path = listen[len("unix:") :] if listen.startswith("unix:") else None

    try:
        server.run(sockets=[sock])
    finally:
        _cleanup(sock, socket_path, log)


def _prepare(engine: Engine) -> tuple[str, int, socket.socket]:
    """Everything that has to be true before a handshake can honestly be printed."""
    if not engine.id:
        raise StartupError("an engine must set `id`")

    declared = os.environ.get("RHAPSODE_WORKER_ENGINE")
    if declared is None:
        raise StartupError("RHAPSODE_WORKER_ENGINE is not set")
    if declared != engine.id:
        # The core spawned this process believing it was something. A mismatch is a misconfigured
        # catalog entry, and it is worth a loud failure now rather than a confusing 404 later.
        raise StartupError(f'the core spawned "{declared}" and this engine is "{engine.id}"')

    contract = negotiate_contract(os.environ.get("RHAPSODE_WORKER_CONTRACT", "1"))

    where = os.environ.get("RHAPSODE_WORKER_LISTEN")
    if where is None:
        raise StartupError("RHAPSODE_WORKER_LISTEN is not set")
    target = parse_listen(where)

    engine.device = detect_device()
    engine.voice_dir = Path(os.environ.get("RHAPSODE_VOICE_DIR", f"./voices/{engine.id}"))
    engine.log = Log(engine=engine.id)
    engine.variant = None

    variants = engine.variants()
    if not variants:
        raise StartupError("an engine must declare at least one variant")
    if engine.default_variant is not None and engine.default_variant not in variants:
        raise StartupError(f'default_variant "{engine.default_variant}" is not one of {sorted(variants)}')

    sock = bind(target)
    return target.describe(sock), contract, sock


def _server(app: Any) -> Any:
    import uvicorn

    from .trailers import with_trailers

    config = uvicorn.Config(
        with_trailers(app),
        # h11, never httptools even where it is installed, because only over h11 can the SDK send
        # the trailer a streamed /speak ends with (§ 6). See trailers.py.
        http="h11",
        log_config=None,
        # uvicorn's own access log would go to stdout, which is sealed, and would duplicate what the
        # core already records about every request it made.
        access_log=False,
        lifespan="off",
    )
    return uvicorn.Server(config)


def _install_signal_handlers(server: Any, worker: Worker, log: Log) -> None:
    """Drain on SIGTERM, and treat SIGINT the same way.

    SIGINT is a synonym because the core spawns workers in its own process group, so a Ctrl-C on a
    TTY reaches them directly and before any SIGTERM does. A worker that only handled SIGTERM would
    die mid-utterance every time a developer stopped the core by hand.

    uvicorn installs its own handlers when it starts, which replace these. That is fine and is the
    point: these cover the window before it starts, and `should_exit` set here is honoured the
    moment it does.
    """

    def drain(signum: int, _frame: Any) -> None:
        log.info("draining", signal=signal.Signals(signum).name)
        worker.draining = True
        server.should_exit = True

    signal.signal(signal.SIGTERM, drain)
    signal.signal(signal.SIGINT, drain)


def _cleanup(sock: socket.socket, socket_path: str | None, log: Log) -> None:
    # uvicorn usually closed the socket already, and the core may have unlinked the path first.
    # Neither is a problem worth reporting at the point the process is leaving anyway.
    with contextlib.suppress(OSError):
        sock.close()
    if socket_path:
        with contextlib.suppress(OSError):
            os.unlink(socket_path)
    log.info("stopped")
    sys.stderr.flush()
