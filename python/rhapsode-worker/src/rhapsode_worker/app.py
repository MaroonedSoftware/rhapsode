"""The ASGI app a worker serves. protocol.md § 1: the engine-scoped subset of the public API."""

from __future__ import annotations

import asyncio
import json
from typing import Any

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from . import encoding
from .engine import CreateVoiceRequest
from .errors import BadRequest, WorkerError, classify
from .worker import Worker


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
        reference = form.get("reference")
        if reference is None or isinstance(reference, str):
            raise BadRequest("`reference` must be an uploaded file")
        voice_id = form.get("id")
        if not isinstance(voice_id, str) or not voice_id:
            raise BadRequest("`id` is required")
        label = form.get("label")
        document = await worker.create_voice(
            CreateVoiceRequest(
                id=voice_id,
                reference=await reference.read(),
                label=label if isinstance(label, str) else None,
                filename=reference.filename,
            )
        )
        return JSONResponse(document, status_code=201)

    async def delete_voice(request: Request) -> Response:
        worker.reject_if_draining()
        await worker.delete_voice(request.path_params["voice"])
        return Response(status_code=204)

    async def load(request: Request) -> Response:
        worker.reject_if_draining()
        body = await _json_body(request)
        variant = body.get("variant")
        if variant is not None and not isinstance(variant, str):
            raise BadRequest("`variant` must be a string")
        await worker.ensure_loaded(variant)
        return JSONResponse(worker.health())

    async def unload(_: Request) -> Response:
        await worker.unload()
        return JSONResponse(worker.health())

    async def speak(request: Request) -> Response:
        worker.reject_if_draining()
        spoken = worker.validate(await _json_body(request))
        await worker.ensure_loaded(spoken.variant)

        async with worker.slots():
            chunks = await asyncio.to_thread(lambda: b"".join(worker.pcm(spoken)))

        native = worker.engine.native_format
        if spoken.format == "wav":
            body = encoding.wav_header(native.sample_rate, native.channels, len(chunks)) + chunks
        else:
            body = chunks
        return Response(
            body,
            media_type=encoding.content_type_for(spoken.format, native.sample_rate, native.channels),
        )

    async def on_worker_error(_: Request, error: Exception) -> Response:
        failure = classify(error)
        if failure.status >= 500:
            worker.log.error("request failed", code=failure.code, error=error)
        else:
            worker.log.debug("request refused", code=failure.code, message=str(failure))
        return JSONResponse(failure.envelope(), status_code=failure.status)

    return Starlette(
        routes=[
            Route("/health", health, methods=["GET"]),
            Route("/capabilities", capabilities, methods=["GET"]),
            Route("/voices", voices, methods=["GET"]),
            Route("/voices", create_voice, methods=["POST"]),
            Route("/voices/{voice}", delete_voice, methods=["DELETE"]),
            Route("/load", load, methods=["POST"]),
            Route("/unload", unload, methods=["POST"]),
            Route("/speak", speak, methods=["POST"]),
        ],
        exception_handlers={Exception: on_worker_error, WorkerError: on_worker_error},
    )


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
