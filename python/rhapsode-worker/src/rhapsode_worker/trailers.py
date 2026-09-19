"""HTTP trailers, which uvicorn does not send. protocol.md § 6.

A streamed `/speak` knows its duration only once the last sample has gone, so § 6 puts it in a
trailer. ASGI has an extension for that, `http.response.trailers`, and none of uvicorn's HTTP
implementations serve it: h11 can write trailers, but uvicorn always ends a response with an empty
`EndOfMessage()`.

So the SDK wraps its app in `with_trailers`, which serves the extension on top of uvicorn's h11
request cycle. It holds back the body message that would end the response, and when the trailers
arrive it sends that same message through uvicorn's own `send`, with the h11 connection's `send`
wrapped for the call so the `EndOfMessage` uvicorn writes carries them. uvicorn's bookkeeping for a
finished response (keep-alive, close, the next request) stays its own.

It is a wrapper rather than a subclass of uvicorn's protocol because the ASGI `send` belongs to a
per-request `RequestResponseCycle`, which the protocol constructs by name in the middle of a
60-line method, and replacing it would mean copying that method. The wrapper advertises the
extension only when `send` really is that cycle's and the request is HTTP/1.1, so under any other
server a response simply goes without the trailer. The test that reads one back over a socket is
what notices when a uvicorn release changes the shape this leans on.
"""

from __future__ import annotations

from typing import Any

import h11
from uvicorn.protocols.http.h11_impl import RequestResponseCycle

#: The ASGI extension key. An app sends trailers only when the server put this in `scope`.
EXTENSION = "http.response.trailers"


def with_trailers(app: Any) -> Any:
    """`app`, with `http.response.trailers` served wherever uvicorn's h11 cycle is underneath."""

    async def wrapped(scope: Any, receive: Any, send: Any) -> None:
        cycle = getattr(send, "__self__", None)
        # HTTP/1.1 only: an HTTP/1.0 response has no chunked encoding to carry a trailer in, and h11
        # refuses to write one rather than drop it. The core speaks 1.1.
        if not (
            scope["type"] == "http"
            and scope.get("http_version") == "1.1"
            and isinstance(cycle, RequestResponseCycle)
        ):
            await app(scope, receive, send)
            return

        scope = {**scope, "extensions": {**scope.get("extensions", {}), EXTENSION: {}}}
        await app(scope, receive, _TrailerSend(send, cycle))

    return wrapped


class _TrailerSend:
    """An ASGI `send` that understands `http.response.trailers`, over one uvicorn h11 cycle."""

    def __init__(self, send: Any, cycle: RequestResponseCycle) -> None:
        self.send = send
        self.cycle = cycle
        self.expected = False
        self.trailers: list[tuple[bytes, bytes]] = []

    async def __call__(self, message: Any) -> None:
        kind = message["type"]

        if kind == "http.response.start":
            self.expected = bool(message.get("trailers", False))
            await self.send(message)
        elif kind == "http.response.body" and self.expected and not message.get("more_body", False):
            # The end of the body is not the end of the message while trailers are still to come.
            await self.send({**message, "more_body": True})
        elif kind == "http.response.trailers":
            if not self.expected:
                raise RuntimeError("http.response.trailers sent for a response that did not declare trailers")
            self.trailers.extend(message.get("headers", []))
            if not message.get("more_trailers", False):
                await self._finish()
        else:
            await self.send(message)

    async def _finish(self) -> None:
        self.expected = False
        connection = self.cycle.conn
        write = connection.send
        trailers = self.trailers

        def ending_with_trailers(event: Any) -> Any:
            if isinstance(event, h11.EndOfMessage):
                event = h11.EndOfMessage(headers=trailers)
            return write(event)

        connection.send = ending_with_trailers  # type: ignore[method-assign]
        try:
            await self.send({"type": "http.response.body", "body": b"", "more_body": False})
        finally:
            del connection.send
