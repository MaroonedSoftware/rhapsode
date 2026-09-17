"""Binding, the handshake line, and sealing stdout afterwards. protocol.md § 2."""

from __future__ import annotations

import contextlib
import io
import json
import os
import socket
from dataclasses import dataclass

BACKLOG = 128

#: Highest and lowest contract major this SDK can speak. protocol.md § 9: the core offers its
#: maximum and the worker answers at the highest version it supports that is not above it.
SUPPORTED_CONTRACTS = range(1, 2)


class StartupError(RuntimeError):
    """Something went wrong before the handshake, so the process exits and stderr is the message."""


@dataclass(frozen=True)
class Listen:
    """Where to listen, parsed from RHAPSODE_WORKER_LISTEN."""

    kind: str  # "unix" | "tcp"
    path: str | None = None
    host: str | None = None
    port: int | None = None

    def describe(self, sock: socket.socket) -> str:
        """The value that goes in the handshake, with an OS-chosen port resolved."""
        if self.kind == "unix":
            return f"unix:{self.path}"
        host, port = sock.getsockname()[:2]
        return f"tcp:{host}:{port}"


def parse_listen(value: str) -> Listen:
    if value.startswith("unix:"):
        path = value[len("unix:") :]
        if not path:
            raise StartupError(f"RHAPSODE_WORKER_LISTEN has no path: {value!r}")
        return Listen(kind="unix", path=path)

    if value.startswith("tcp:"):
        # rpartition rather than split, so an IPv6 literal keeps its colons.
        host, separator, port = value[len("tcp:") :].rpartition(":")
        if not separator or not port.isdigit():
            raise StartupError(f"RHAPSODE_WORKER_LISTEN is not tcp:<host>:<port>: {value!r}")
        return Listen(kind="tcp", host=host, port=int(port))

    raise StartupError(f"RHAPSODE_WORKER_LISTEN must start with unix: or tcp:, got {value!r}")


def negotiate_contract(offered: str) -> int:
    """Pick the highest version we speak that is not above the core's offer. protocol.md § 9."""
    try:
        ceiling = int(offered)
    except ValueError as error:
        raise StartupError(f"RHAPSODE_WORKER_CONTRACT is not an integer: {offered!r}") from error

    usable = [version for version in SUPPORTED_CONTRACTS if version <= ceiling]
    if not usable:
        raise StartupError(
            f"this worker speaks contract {min(SUPPORTED_CONTRACTS)} and above; "
            f"the core offered {ceiling}. Upgrade the core or pin an older engine."
        )
    return max(usable)


def bind(listen: Listen) -> socket.socket:
    """Bind and listen, so that a core connecting the instant it reads the handshake simply queues.

    Binding here rather than letting uvicorn do it buys three things. An OS-chosen port is knowable
    from ``getsockname()`` before ``listen()``, so the handshake can carry it with no race and no
    polling. The socket gets mode 0600 rather than uvicorn's world-writable 0666, which is the wrong
    default for a socket that accepts file uploads and spends GPU time on request. And "bound" and
    "handshake printed" end up as adjacent lines rather than either side of a framework callback.
    """
    if listen.kind == "unix":
        assert listen.path is not None
        directory = os.path.dirname(listen.path)
        if directory:
            os.makedirs(directory, exist_ok=True)
        # A predecessor that was SIGKILLed leaves its socket file behind. EADDRINUSE after this
        # means a live worker still owns the path, which is a real conflict and not ours to break.
        with contextlib.suppress(FileNotFoundError):
            if os.path.exists(listen.path) and not _is_live(listen.path):
                os.unlink(listen.path)
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        previous = os.umask(0o177)
        try:
            sock.bind(listen.path)
        finally:
            os.umask(previous)
    else:
        assert listen.host is not None and listen.port is not None
        family = socket.AF_INET6 if ":" in listen.host else socket.AF_INET
        sock = socket.socket(family, socket.SOCK_STREAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind((listen.host, listen.port))

    sock.listen(BACKLOG)
    return sock


def _is_live(path: str) -> bool:
    """Whether something is accepting on this socket path already."""
    probe = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        probe.settimeout(0.2)
        probe.connect(path)
    except OSError:
        return False
    else:
        return True
    finally:
        probe.close()


def announce(engine: str, contract: int, listen: str) -> None:
    """Print the one line this process is ever allowed to put on stdout.

    Written to ``sys.__stdout__`` rather than ``sys.stdout`` because by the time this runs an
    imported adapter module may already have replaced the latter.
    """
    import sys

    line = json.dumps(
        {"ready": True, "contract": contract, "engine": engine, "listen": listen},
        separators=(",", ":"),
    )
    stream = sys.__stdout__
    assert stream is not None
    stream.write(line + "\n")
    stream.flush()


def seal_stdout(log: object) -> None:
    """Make stdout unusable for anything but the handshake that has already gone.

    § 2 says to capture ``sys.stdout``, which catches ``print()`` and misses everything a native
    library writes to fd 1 directly. That is the corruption the rule exists to prevent: adapters
    import torch, torch imports CUDA runtimes, and those write to fd 1 in C. So the seal happens at
    both levels, and it happens only after the handshake has been flushed.
    """
    import sys

    if sys.__stdout__ is not None:
        sys.__stdout__.flush()
    # fd 1 becomes the stderr pipe, which is the half that catches a native library writing to the
    # descriptor directly. The sys.stdout replacement below is the other half, and catches print().
    os.dup2(2, 1)
    sys.stdout = _LogWriter(log)


class _LogWriter(io.TextIOBase):
    """A line-buffered file object that turns stray prints into well-formed log records."""

    def __init__(self, log: object) -> None:
        self._log = log
        self._buffer = ""

    def write(self, text: str) -> int:
        self._buffer += text
        while "\n" in self._buffer:
            line, self._buffer = self._buffer.split("\n", 1)
            if line:
                emit = getattr(self._log, "info", None)
                if callable(emit):
                    emit(line, source="stdout")
        return len(text)

    def flush(self) -> None:
        if self._buffer:
            emit = getattr(self._log, "info", None)
            if callable(emit):
                emit(self._buffer, source="stdout")
            self._buffer = ""

    def isatty(self) -> bool:
        return False

    def fileno(self) -> int:
        return 1
