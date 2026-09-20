"""The ASGI app a worker serves. protocol.md § 1: the engine-scoped subset of the public API."""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, Response, StreamingResponse
from starlette.routing import Route

from . import encoding, streaming, trailers
from .engine import CreateVoiceRequest, DialogueRequest, SpeakRequest, check_voice_id
from .errors import BadRequest, WorkerError, classify
from .worker import Worker

#: Above this ASGI spec version Starlette stops racing its own disconnect listener and relies on
#: `send()` raising, which uvicorn does not do. See `_check_disconnect_assumption`.
DISCONNECT_RACE_CEILING = (2, 4)

#: § 6. A header on a buffered answer, because only there is the duration known before the headers,
#: and a trailer on a streamed one.
DURATION_HEADER = "X-Rhapsode-Duration-Ms"


def create_app(worker: Worker) -> Starlette:
    async def health(_: Request) -> Response:
        # Answers while unloaded and while draining. A health endpoint that waits on the thing it
        # reports about is one that times out exactly when you need it.
        return JSONResponse(worker.health())

    async def capabilities(_: Request) -> Response:
        return JSONResponse(worker.capabilities())

    async def voices(_: Request) -> Response:
        return JSONResponse(await asyncio.to_thread(worker.voices))

    async def create_voice(request: Request) -> Response:
        worker.reject_if_draining()
        form = await request.form()
        voice_id = form.get("id")
        if not isinstance(voice_id, str) or not voice_id:
            raise BadRequest("`id` is required")
        label = form.get("label")
        label = label if isinstance(label, str) and label else None
        reference = form.get("reference")
        blend = form.get("blend")

        # Exactly one, protocol.md § 7. Both is a caller who does not know which they meant.
        if reference is not None and blend is not None:
            raise BadRequest("send `reference` or `blend`, not both")
        if blend is not None:
            if not isinstance(blend, str):
                raise BadRequest("`blend` must be a recipe, not a file")
            return JSONResponse(await worker.blend_voice(voice_id, blend, label), status_code=201)
        if reference is None or isinstance(reference, str):
            raise BadRequest("`reference` must be an uploaded file, or send a `blend` recipe")
        transcript = form.get("transcript")
        document = await worker.create_voice(
            CreateVoiceRequest(
                id=voice_id,
                reference=await reference.read(),
                label=label,
                filename=reference.filename,
                # Blank is absent, because a form field left empty arrives as "" and an engine that
                # needs the words should be able to refuse a create that gave none.
                transcript=transcript.strip() or None if isinstance(transcript, str) else None,
            )
        )
        return JSONResponse(document, status_code=201)

    async def delete_voice(request: Request) -> Response:
        worker.reject_if_draining()
        await worker.delete_voice(request.path_params["voice"])
        return Response(status_code=204)

    async def preview(request: Request) -> Response:
        """A fixed line in one voice, so `previewUrl` works for every engine with no adapter effort.

        Buffered rather than streamed: a preview is short, a client is usually rendering several at
        once to fill a list, and a buffered failure is a status rather than a broken connection.
        """
        worker.reject_if_draining()
        voice = check_voice_id(request.path_params["voice"])
        await worker.ensure_loaded(None)

        native = worker.engine.native_format
        async with worker.slots():
            await worker.until_synthesising_fewer_than(max(1, worker.engine.concurrency))
            pcm = bytearray()
            async for chunk in worker.preview(voice):
                pcm.extend(chunk)

        body = encoding.wav_header(native.sample_rate, native.channels, len(pcm)) + bytes(pcm)
        return Response(body, media_type="audio/wav")

    async def load(request: Request) -> Response:
        worker.reject_if_draining()
        body = await _json_body(request)
        variant = body.get("variant")
        if variant is not None and not isinstance(variant, str):
            raise BadRequest("`variant` must be a string")
        await worker.ensure_loaded(variant)
        return JSONResponse(worker.health())

    async def fetch(request: Request) -> Response:
        worker.reject_if_draining()
        body = await _json_body(request)
        variant = body.get("variant")
        if not isinstance(variant, str) or variant == "":
            raise BadRequest("`variant` is required, and must be a string")
        await worker.fetch(variant)
        return Response(status_code=204)

    async def unload(_: Request) -> Response:
        await worker.unload()
        return JSONResponse(worker.health())

    async def terminate(_: Request) -> Response:
        # Drain and exit 0, which is the only way to reclaim what an unload cannot: the graphics
        # runtime holds the rest until the process goes. 202 rather than 200 because the answer has
        # to leave before the process does, so the evidence it worked is the socket closing.
        worker.log.info("terminating on request")
        worker.draining = True
        worker.request_stop()
        return Response(status_code=202)

    async def speak(request: Request) -> Response:
        worker.reject_if_draining()
        _check_disconnect_assumption(request, worker)
        return await answer(worker.validate(await _json_body(request)))

    async def dialogue(request: Request) -> Response:
        # Refused before the body is read by an engine without it, so an old client that sends a
        # conversation to the wrong engine hears why rather than a validation error about its turns.
        worker.reject_if_draining()
        _check_disconnect_assumption(request, worker)
        return await answer(worker.validate_dialogue(await _json_body(request)))

    async def answer(spoken: SpeakRequest | DialogueRequest) -> Response:
        """Everything after validation, which `/speak` and `/dialogue` do identically: load on demand,
        hold a slot for as long as the audio lasts, and fail with a status for as long as one can
        still be sent. protocol.md § 6."""
        await worker.ensure_loaded(spoken.variant)

        native = worker.engine.native_format
        content_type = encoding.content_type_for(spoken.format, native.sample_rate, native.channels)

        # Serialised by default: one model, one utterance at a time is the right answer for a GPU.
        # The slot is held until the audio has finished, not until this handler returns, because a
        # streaming handler returns long before the audio does.
        await worker.slots().acquire()
        released = False
        # And until an abandoned synthesis has really ended, since it is still on the device: one
        # model, one utterance at a time is what `concurrency` promises. protocol.md § 3.
        try:
            await worker.until_synthesising_fewer_than(max(1, worker.engine.concurrency))
        except BaseException:
            worker.slots().release()
            raise

        def release() -> None:
            nonlocal released
            if not released:
                released = True
                worker.slots().release()

        try:
            if not spoken.stream:
                # Buffered: the audio is finished by the time this returns, so the slot goes back
                # here. The streaming branch cannot do the same, which is the whole reason release()
                # exists rather than a `with` statement around the handler.
                try:
                    return await _buffered(worker, spoken, content_type, native)
                finally:
                    release()

            # Pull the first chunk before a status exists. Starlette sends http.response.start
            # before it pulls anything, so without this an unknown voice or an OOM during the
            # on-demand load would already have committed a 200, and the only move left would be to
            # abort a connection that could have carried a perfectly good 404.
            #
            # Twice, because either side can fail first. The engine's PCM is primed before encoding,
            # since a streamed WAV yields its header before asking the engine for anything, and
            # priming only the encoded stream primed that header: an unknown voice in wav was an
            # aborted connection. The encoded stream is primed after, so an ffmpeg that cannot start
            # is still a status.
            first_pcm, pcm = await streaming.prime(worker.synthesis(spoken))
            if first_pcm is None:
                raise WorkerError("the engine produced no audio")
            counted = _Counted(pcm)
            source = encoding.encode(
                spoken.format,
                counted.stream(),
                sample_rate=native.sample_rate,
                channels=native.channels,
            )
            first, rest = await streaming.prime(source)
            if first is None:
                raise WorkerError("the engine produced no audio")
        except BaseException:
            release()
            raise

        async def body() -> Any:
            try:
                async for chunk in rest:
                    yield chunk
            except BaseException as error:
                # Once a 200 and a Content-Type are on the wire the status cannot be taken back, so
                # the only honest ending is an aborted connection. Raising here is what produces it:
                # uvicorn closes the transport without the terminating chunk, and the core sees a
                # truncated body rather than a short successful one.
                failure = classify(error)
                worker.log.error("speak failed after the headers went out", code=failure.code, error=error)
                raise
            finally:
                release()

        return _TimedStream(
            body(),
            media_type=content_type,
            duration_ms=lambda: _duration_ms(counted.bytes, native.sample_rate, native.channels),
        )

    def refusal(error: Exception) -> Response:
        failure = classify(error)
        if failure.status >= 500:
            # The error as the adapter raised it, so the log names the ValueError and its traceback
            # rather than the Internal it was classified as.
            worker.log.error("request failed", code=failure.code, error=error)
        else:
            worker.log.debug("request refused", code=failure.code, message=str(failure))
        return JSONResponse(failure.envelope(), status_code=failure.status)

    async def on_worker_error(_: Request, error: Exception) -> Response:
        return refusal(error)

    def answered(endpoint: Endpoint) -> Endpoint:
        """Every exception an endpoint raises becomes its answer here, inside the route.

        Starlette gives a handler keyed on `Exception` to its outermost middleware, which sends the
        handler's response and then raises again, and uvicorn closes the socket. So a plain
        ValueError out of an adapter answered a correct 500 and the next request on that keep-alive
        connection was reset: a conformance check "raised: Connection reset by peer" on 2026-09-19,
        and the core pools its connections to a worker. A WorkerError never did this, because its
        handler runs in the inner middleware that does not raise again, so the fix is to classify
        everything before it can get that far.

        Only the endpoint is wrapped, not the response it returns. A streamed `/speak` fails after
        its headers inside the response, and that one must still abort the connection (§ 6).
        """

        async def wrapped(request: Request) -> Response:
            try:
                return await endpoint(request)
            except Exception as error:
                return refusal(error)

        return wrapped

    return Starlette(
        routes=[
            Route("/health", answered(health), methods=["GET"]),
            Route("/capabilities", answered(capabilities), methods=["GET"]),
            Route("/voices", answered(voices), methods=["GET"]),
            Route("/voices", answered(create_voice), methods=["POST"]),
            Route("/voices/{voice}", answered(delete_voice), methods=["DELETE"]),
            Route("/voices/{voice}/preview", answered(preview), methods=["GET"]),
            Route("/load", answered(load), methods=["POST"]),
            Route("/unload", answered(unload), methods=["POST"]),
            Route("/terminate", answered(terminate), methods=["POST"]),
            Route("/fetch", answered(fetch), methods=["POST"]),
            Route("/speak", answered(speak), methods=["POST"]),
            Route("/dialogue", answered(dialogue), methods=["POST"]),
        ],
        # Behind `answered`, for anything raised outside an endpoint. Starlette's own 404 and 405
        # are HTTPExceptions and never reach either.
        exception_handlers={Exception: on_worker_error, WorkerError: on_worker_error},
    )


Endpoint = Callable[[Request], Awaitable[Response]]


async def _json_body(request: Request) -> dict[str, Any]:
    raw = await request.body()
    if not raw:
        return {}
    try:
        body = json.loads(raw)
    except ValueError as error:
        raise BadRequest(f"the body is not JSON: {error}") from error
    if not isinstance(body, dict):
        raise BadRequest("the body must be a JSON object")
    return body


async def _buffered(worker: Worker, spoken: Any, content_type: str, native: Any) -> Response:
    """`stream: false`, which reports failures strictly better than streaming does.

    Every failure is still a pre-headers failure, so a problem that would have been an aborted
    connection becomes an ordinary error envelope with a code and a retryable flag. It is also the
    only case where a WAV header can carry the real sizes.
    """
    pcm = bytearray()
    async for chunk in worker.synthesis(spoken):
        pcm.extend(chunk)

    async def once() -> Any:
        yield bytes(pcm)

    body = bytearray()
    async for chunk in encoding.encode(
        spoken.format,
        once(),
        sample_rate=native.sample_rate,
        channels=native.channels,
        length=len(pcm),
    ):
        body.extend(chunk)

    duration_ms = _duration_ms(len(pcm), native.sample_rate, native.channels)
    return Response(bytes(body), media_type=content_type, headers={DURATION_HEADER: str(duration_ms)})


def _duration_ms(pcm_bytes: int, sample_rate: int, channels: int) -> int:
    """From the PCM rather than the encoded body, because an mp3 or opus body's length says nothing
    about how long it plays. The native format is s16le, two bytes a sample."""
    return round(pcm_bytes // (2 * channels) * 1000 / sample_rate)


class _Counted:
    """The engine's PCM, passed through unchanged, counting the bytes for the duration."""

    def __init__(self, source: AsyncIterator[bytes]) -> None:
        self._source = source
        self.bytes = 0

    async def stream(self) -> AsyncIterator[bytes]:
        try:
            async for chunk in self._source:
                self.bytes += len(chunk)
                yield chunk
        finally:
            # Closed with this layer rather than left to the collector, so a client that hangs up
            # still reaches the engine's generator, which is what stops the synthesis.
            await streaming.aclose(self._source)


class _TimedStream(StreamingResponse):
    """A streamed answer that ends with its duration in a trailer. § 6.

    Only `stream_response` is overridden: Starlette's `__call__` is where it races its own disconnect
    listener, which `_check_disconnect_assumption` explains is what stops a synthesis nobody is
    listening to, and that stays exactly as it was. A failure mid-stream raises out of the body before
    the trailer, so an aborted connection never carries a duration for audio that did not arrive.
    """

    def __init__(self, content: Any, *, media_type: str, duration_ms: Any) -> None:
        super().__init__(content, media_type=media_type)
        self._duration_ms = duration_ms
        self._trailers = False

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        # Declared only where the server said it can send one. Under a server without the extension
        # the response is what it always was, with no promise in it that nothing keeps.
        self._trailers = trailers.EXTENSION in scope.get("extensions", {})
        if self._trailers:
            self.headers["trailer"] = DURATION_HEADER
        await super().__call__(scope, receive, send)

    async def stream_response(self, send: Any) -> None:
        start = {"type": "http.response.start", "status": self.status_code, "headers": self.raw_headers}
        await send({**start, "trailers": True} if self._trailers else start)
        async for chunk in self.body_iterator:
            await send({"type": "http.response.body", "body": chunk, "more_body": True})
        await send({"type": "http.response.body", "body": b"", "more_body": False})
        if self._trailers:
            value = str(self._duration_ms()).encode()
            await send(
                {
                    "type": "http.response.trailers",
                    "headers": [(DURATION_HEADER.lower().encode(), value)],
                    "more_trailers": False,
                }
            )


_warned_about_disconnect = False


def _check_disconnect_assumption(request: Request, worker: Worker) -> None:
    """Say so, loudly and once, if the thing that stops a cancelled synthesis has gone away.

    uvicorn silently drops writes after the peer is gone, so an app that never learns about a
    disconnect runs to the end of a line nobody is listening to, holding the card the whole time.
    Starlette saves us, but only because it races its own disconnect listener while the ASGI spec
    version is below 2.4. That is a load-bearing coincidence of two version numbers, and a silent
    regression would look like nothing at all.
    """
    global _warned_about_disconnect
    if _warned_about_disconnect:
        return

    version = str(request.scope.get("asgi", {}).get("spec_version", "2.0"))
    try:
        parsed = tuple(int(part) for part in version.split("."))
    except ValueError:  # pragma: no cover - a server with a version we cannot read
        parsed = (0,)

    if parsed >= DISCONNECT_RACE_CEILING:
        _warned_about_disconnect = True
        worker.log.warn(
            "this ASGI server reports a spec version at or above 2.4, where a cancelled request may "
            "no longer stop the engine; a synthesis nobody is listening to will hold the device",
            spec_version=version,
        )
