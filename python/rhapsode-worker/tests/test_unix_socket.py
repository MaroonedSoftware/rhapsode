"""The default transport. protocol.md § 1: HTTP over a Unix domain socket unless told otherwise."""

from __future__ import annotations

import http.client
import json
import socket
import tempfile
from pathlib import Path

import pytest
from conftest import await_handshake, spawn, stop


def _can_bind_unix_sockets() -> bool:
    """Some sandboxes permit the file but refuse the bind, which is not a failure of this code."""
    with tempfile.TemporaryDirectory() as directory:
        probe = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        try:
            probe.bind(str(Path(directory) / "probe.sock"))
        except OSError:
            return False
        finally:
            probe.close()
    return True


requires_unix_sockets = pytest.mark.skipif(
    not _can_bind_unix_sockets(),
    reason="this environment does not permit binding AF_UNIX sockets",
)


class _UnixConnection(http.client.HTTPConnection):
    def __init__(self, path: str) -> None:
        super().__init__("localhost", timeout=30)
        self._path = path

    def connect(self) -> None:
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(self._path)


@requires_unix_sockets
def test_a_worker_serves_over_a_unix_socket_and_tidies_up_after_itself() -> None:
    with tempfile.TemporaryDirectory() as directory:
        path = str(Path(directory) / "tone.sock")
        process = spawn(listen=f"unix:{path}")
        try:
            handshake = await_handshake(process)
            assert handshake["listen"] == f"unix:{path}"

            # 0600, not uvicorn's own 0666. A socket that accepts file uploads and spends GPU time
            # on request has no business being world-writable.
            assert oct(Path(path).stat().st_mode & 0o777) == "0o600"

            connection = _UnixConnection(path)
            connection.request("GET", "/health")
            health = json.loads(connection.getresponse().read())
            assert health["process"] == "up"

            connection.request(
                "POST",
                "/speak",
                body=json.dumps({"text": "over a unix socket", "format": "wav", "stream": False}),
                headers={"content-type": "application/json"},
            )
            audio = connection.getresponse().read()
            assert audio.startswith(b"RIFF") and len(audio) > 256
            connection.close()
        finally:
            assert stop(process) == 0

        # A socket file left behind is what the next worker trips over, and the unlink is easy to
        # lose: uvicorn closes the socket it was handed, so asking it for its own path at shutdown
        # raises and quietly does nothing.
        assert not Path(path).exists()


@requires_unix_sockets
def test_a_stale_socket_file_does_not_stop_a_restart() -> None:
    # What a SIGKILLed predecessor leaves behind. A worker that refused to start here would need an
    # operator to clean up by hand after every hard kill.
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "tone.sock"
        path.write_bytes(b"")

        process = spawn(listen=f"unix:{path}")
        try:
            assert await_handshake(process)["listen"] == f"unix:{path}"
        finally:
            stop(process)
