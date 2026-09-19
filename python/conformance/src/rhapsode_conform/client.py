"""Talking to a worker, wherever it is.

A local worker is a unix socket and a remote one is a URL, and § 1 claims those are the same code
path rather than two. This file is where that claim is either true or a lie: one class, one
difference, and it is the transport httpx is handed.
"""

from __future__ import annotations

import json
from typing import Any, Self

import httpx

#: A long synthesis on a cold CPU legitimately takes minutes, and a conformance run should wait.
READ_TIMEOUT_SECONDS = 300.0

#: A worker that has not answered its headers by now is wedged rather than slow, which is the same
#: distinction § 2 draws about the handshake.
CONNECT_TIMEOUT_SECONDS = 30.0


class Worker:
    """One worker, addressed the way the core addresses it."""

    def __init__(self, target: str) -> None:
        self.target = target
        timeout = httpx.Timeout(READ_TIMEOUT_SECONDS, connect=CONNECT_TIMEOUT_SECONDS)

        if target.startswith("unix:"):
            path = target[len("unix:") :]
            # The origin is a placeholder the transport ignores. This one argument is the entire
            # difference between a local worker and a remote one.
            self._client = httpx.Client(
                transport=httpx.HTTPTransport(uds=path),
                base_url="http://localhost",
                timeout=timeout,
            )
        elif target.startswith("tcp:"):
            host, _, port = target[len("tcp:") :].rpartition(":")
            self._client = httpx.Client(base_url=f"http://{host}:{port}", timeout=timeout)
        else:
            self._client = httpx.Client(base_url=target, timeout=timeout)

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def get(self, path: str) -> tuple[int, Any]:
        response = self._client.get(path)
        return response.status_code, _decode(response)

    def post(self, path: str, body: dict[str, Any] | None = None) -> tuple[int, Any]:
        response = self._client.post(path, json=body if body is not None else {})
        return response.status_code, _decode(response)

    def create_voice(
        self,
        voice_id: str,
        reference: bytes,
        filename: str = "reference.wav",
        transcript: str | None = None,
    ) -> tuple[int, Any]:
        fields = {"id": voice_id} | ({} if transcript is None else {"transcript": transcript})
        response = self._client.post(
            "/voices",
            data=fields,
            files={"reference": (filename, reference, "audio/wav")},
        )
        return response.status_code, _decode(response)

    def delete(self, path: str) -> tuple[int, Any]:
        response = self._client.delete(path)
        return response.status_code, _decode(response)

    def get_bytes(self, path: str) -> tuple[int, bytes]:
        response = self._client.get(path)
        return response.status_code, response.content

    def speak(self, body: dict[str, Any]) -> tuple[int, bytes]:
        response = self._client.post("/speak", json=body)
        return response.status_code, response.content

    def speak_with_headers(self, body: dict[str, Any]) -> tuple[int, bytes, dict[str, str]]:
        response = self._client.post("/speak", json=body)
        return response.status_code, response.content, dict(response.headers)

    def speak_streaming(self, body: dict[str, Any]) -> list[bytes]:
        pieces: list[bytes] = []
        with self._client.stream("POST", "/speak", json=body) as response:
            for chunk in response.iter_raw():
                if chunk:
                    pieces.append(chunk)
        return pieces


def _decode(response: httpx.Response) -> Any:
    if not response.content:
        return None
    try:
        return json.loads(response.content)
    except ValueError:
        return response.content
