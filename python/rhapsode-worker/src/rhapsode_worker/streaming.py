"""Getting a blocking generator's output onto the event loop, and stopping it when nobody is reading.

`speak()` is a sync generator in the adapter-facing API because torch is sync and adapter authors
write sync code. Forcing `async def` on somebody wrapping a blocking `model.stream()` produces a
worse adapter, not a better one, so the SDK runs it on a thread and bridges it here.

The queue is bounded, and that bound is the whole design. It is what carries backpressure from the
socket all the way back to the GPU: when the core stops reading, the encoder's pipe fills, the
encoder stops reading its stdin, this queue fills, and the engine thread blocks at its next yield.
An unbounded queue would turn a slow reader into unbounded memory and keep the card busy generating
audio nobody will ever hear.
"""

from __future__ import annotations

import asyncio
import contextlib
import threading
from collections.abc import AsyncIterator, Callable, Iterator
from typing import Any

#: Four chunks of lookahead. Enough that the engine is not woken for every read, small enough that
#: a cancelled request stops the model within a chunk or two rather than a buffer's worth.
QUEUE_DEPTH = 4


class _Stop:
    """End of stream, or the failure that ended it."""

    def __init__(self, error: BaseException | None) -> None:
        self.error = error


async def from_blocking(
    make_iterator: Callable[[], Iterator[bytes]],
    *,
    depth: int = QUEUE_DEPTH,
) -> AsyncIterator[bytes]:
    """Run a blocking generator on a thread and yield what it produces.

    Closing this async generator early, which is what happens when the client goes away, sets the
    stop flag and drains whatever the thread is blocked on, so the engine stops rather than running
    to the end of a line nobody is listening to.
    """
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[bytes | _Stop] = asyncio.Queue(maxsize=depth)
    stopping = threading.Event()

    def put(item: bytes | _Stop) -> None:
        asyncio.run_coroutine_threadsafe(queue.put(item), loop).result()

    def pump() -> None:
        failure: BaseException | None = None
        try:
            for chunk in make_iterator():
                if stopping.is_set():
                    break
                put(chunk)
        except BaseException as error:
            failure = error
        finally:
            # The loop can be gone already when a request is cancelled during shutdown, and there
            # is nobody left to tell.
            with contextlib.suppress(RuntimeError):
                put(_Stop(failure))

    thread = threading.Thread(target=pump, name="rhapsode-speak", daemon=True)
    thread.start()

    try:
        while True:
            item = await queue.get()
            if isinstance(item, _Stop):
                if item.error is not None:
                    raise item.error
                return
            yield item
    finally:
        # Tell the thread to stop, then keep taking items so a `put` it is blocked inside can
        # complete. Without the drain the thread sits in run_coroutine_threadsafe forever holding
        # whatever the model allocated.
        stopping.set()
        while thread.is_alive():
            try:
                queue.get_nowait()
            except asyncio.QueueEmpty:
                await asyncio.sleep(0)
                if thread.is_alive():
                    await asyncio.sleep(0.01)


async def prime(source: AsyncIterator[bytes]) -> tuple[bytes | None, AsyncIterator[bytes]]:
    """Pull the first chunk, and hand back a stream that still starts with it.

    This exists because Starlette's StreamingResponse sends `http.response.start` before it pulls
    the first chunk. A failure on that first chunk, an unknown voice or an OOM during the on-demand
    load, would therefore have already committed a 200, and the only move left would be to abort a
    connection that could have carried a perfectly good 404 with `retryable: false`.

    Priming is what keeps the abort path rare and the error taxonomy useful: everything that fails
    before a byte exists fails as an ordinary error envelope.
    """
    first: bytes | None = None
    async for chunk in source:
        if chunk:
            first = chunk
            break

    if first is None:
        await aclose(source)
        return None, _empty()

    return first, _replay(first, source)


async def _replay(first: bytes, rest: AsyncIterator[bytes]) -> AsyncIterator[bytes]:
    yield first
    async for chunk in rest:
        yield chunk


async def _empty() -> AsyncIterator[bytes]:
    return
    yield b""  # pragma: no cover - unreachable, and makes this a generator


async def aclose(source: Any) -> None:
    """Close an async iterator now, if it can be closed, rather than whenever it is collected."""
    closer = getattr(source, "aclose", None)
    if closer is not None:
        await closer()
