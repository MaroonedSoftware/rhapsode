"""The engine's state, and everything the SDK does so no adapter has to. protocol.md § 3 and § 8."""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Iterator
from typing import Any

from . import encoding
from .engine import CreateVoiceRequest, Engine, SpeakRequest, Voice, check_voice_id
from .errors import BadRequest, Overloaded, Unsupported, WorkerError, classify
from .listen import SUPPORTED_CONTRACTS
from .log import Log


class Worker:
    """One engine, its model state, and the rules the protocol puts on both.

    The worker obeys and the core decides: there is no idle timer here, no eviction policy and no
    opinion about how many models should be resident. Those live in the core, which is the only
    component that can see the whole card.
    """

    def __init__(self, engine: Engine, contract: int, log: Log) -> None:
        self.engine = engine
        self.contract = contract
        self.log = log

        self.model = "unloaded"
        self.draining = False
        self._transition = asyncio.Lock()
        self._slots = asyncio.Semaphore(max(1, engine.concurrency))
        #: Set by serve(), so that /terminate can ask the server to stop without importing it.
        self.stop: Callable[[], None] = lambda: None

    # ---------------------------------------------------------------- documents

    def health(self) -> dict[str, Any]:
        document: dict[str, Any] = {
            "process": "draining" if self.draining else "up",
            "model": self.model,
        }
        if self.engine.variant is not None:
            document["variant"] = self.engine.variant
        device = self.engine.device
        document["device"] = device.type if device.vram_bytes is None else f"{device.type}:0"
        if device.vram_bytes is not None:
            document["vramBytes"] = device.vram_bytes
        return document

    def capabilities(self) -> dict[str, Any]:
        engine = self.engine
        variants = engine.variants()

        document: dict[str, Any] = {
            "contract": self.contract,
            "engine": {
                "id": engine.id,
                "displayName": engine.display_name or engine.id,
                "adapterVersion": engine.adapter_version,
                **({} if engine.upstream_version is None else {"upstreamVersion": engine.upstream_version}),
            },
            "license": _license_document(engine.license),
            "device": engine.device.document(),
            "variants": {name: variant.document() for name, variant in variants.items()},
            "formats": encoding.available_formats(),
        }

        # `current` is absent while nothing is resident, because a worker in up(unloaded) has
        # nothing to describe and an invented answer is worse than no answer. protocol.md § 4.
        if self.model == "loaded" and engine.variant is not None:
            resident = variants[engine.variant]
            reference = engine.reference_seconds()
            document["current"] = {
                **resident.document(),
                "variant": engine.variant,
                "maxCharacters": resident.max_characters or engine.max_characters,
                "cloning": {
                    "supported": engine.supports_cloning,
                    **({} if reference is None else {"referenceSeconds": list(reference)}),
                },
                "streaming": {"supported": True, "granularity": "chunk"},
                "nativeFormat": {
                    "encoding": engine.native_format.encoding,
                    "sampleRate": engine.native_format.sample_rate,
                    "channels": engine.native_format.channels,
                },
            }
        return document

    def voices(self) -> list[dict[str, Any]]:
        return [voice.document() for voice in self.engine.voices()]

    # ---------------------------------------------------------------- residency

    async def ensure_loaded(self, variant: str | None = None) -> None:
        """Load on demand. protocol.md § 3.

        `/speak` does not fail with "no model loaded" and does not require `/load` first. The
        alternative was measured on a running station: the client called a model-info endpoint
        before every single synthesis to find out whether the previous request's unload had emptied
        the server, because nothing else would notice.
        """
        wanted = self.engine.effective_variant(variant)
        async with self._transition:
            if self.model == "loaded" and self.engine.variant == wanted:
                return
            if self.model == "loaded":
                await self._unload_locked()
            await self._load_locked(wanted)

    async def _load_locked(self, variant: str) -> None:
        """Load, and if that fails clear the wreckage and try exactly once more.

        A load that dies on CUDA OOM strands its own partial allocations: 3.5 GiB was measured
        stranded on a 16 GiB card. An immediate retry therefore throws itself at a card it has just
        filled. Unload-then-load-once covers the common case of a card that was briefly full and has
        since freed up, and it lives here so that every adapter gets it without knowing about it.

        Exactly once, because a second failure is a fact about the card rather than about timing,
        and a loop would hold the transition lock while the core waits to try something else.
        """
        try:
            await self._attempt_load(variant)
            return
        except WorkerError as first:
            self.log.warn(
                "model load failed; clearing stranded memory and trying once more",
                variant=variant,
                code=first.code,
                error=first,
            )

        await self._unload_locked(quiet=True)
        await self._attempt_load(variant)

    async def _attempt_load(self, variant: str) -> None:
        self.model = "loading"
        self.log.info("loading", variant=variant)
        try:
            await asyncio.to_thread(self.engine.load, variant)
        except BaseException as error:
            self.model = "unloaded"
            self.engine.variant = None
            raise classify(error) from error
        self.engine.variant = variant
        self.model = "loaded"
        self.log.info("loaded", variant=variant)

    async def _unload_locked(self, *, quiet: bool = False) -> None:
        self.model = "unloading"
        try:
            await asyncio.to_thread(self.engine.unload)
        except Exception as error:
            # An adapter whose unload throws has still lost the model as far as anybody here is
            # concerned, and refusing to move on would strand the worker in `unloading` forever.
            self.log.warn("unload raised; treating the model as gone anyway", error=error)
        finally:
            self.engine.variant = None
            self.model = "unloaded"
        if not quiet:
            self.log.info("unloaded")

    async def unload(self) -> None:
        """Idempotent, and never fatal. Unloading nothing is a success.

        An unload reclaims roughly 70% of what the model held, because the graphics runtime keeps
        the rest until the process exits. That is why the core has `terminate` as well, and why a
        residency manager with only this verb will slowly lose a card to nothing.
        """
        async with self._transition:
            if self.model == "unloaded":
                return
            await self._unload_locked()

    async def fetch(self, variant: str) -> None:
        """Download a variant's weights, outside the transition lock.

        A download touches the disk and the network and never the device, so it has no reason to
        wait for a load to finish or to hold one up. The variant is checked first so that a typo is
        refused in a millisecond rather than after a download attempt names the wrong repository.
        """
        declared = self.engine.variants()
        if variant not in declared:
            raise Unsupported(f'no variant "{variant}"; this engine has {sorted(declared)}')
        try:
            await asyncio.to_thread(self.engine.fetch, variant)
        except BaseException as error:
            raise classify(error) from error

    # ---------------------------------------------------------------- voices

    async def create_voice(self, request: CreateVoiceRequest) -> dict[str, Any]:
        check_voice_id(request.id)
        voice: Voice = await asyncio.to_thread(self.engine.create_voice, request)
        return voice.document()

    async def delete_voice(self, voice_id: str) -> None:
        check_voice_id(voice_id)
        await asyncio.to_thread(self.engine.delete_voice, voice_id)

    # ---------------------------------------------------------------- speaking

    def validate(self, body: dict[str, Any]) -> SpeakRequest:
        """Everything an adapter should never have to check, checked once.

        An adapter never receives a request it did not declare support for, which is what lets its
        `speak()` be about synthesis rather than about argument handling.
        """
        if not isinstance(body, dict):
            raise BadRequest("the body must be a JSON object")

        text = body.get("text")
        if not isinstance(text, str) or not text:
            raise BadRequest("`text` is required and must be a non-empty string")

        variant_name = _optional_str(body, "variant")
        variant_key = self.engine.effective_variant(variant_name)
        variant = self.engine.variants()[variant_key]

        ceiling = variant.max_characters or self.engine.max_characters
        if len(text) > ceiling:
            raise BadRequest(f"`text` is {len(text)} characters and this variant accepts {ceiling}")

        fmt = _optional_str(body, "format") or "wav"
        if fmt not in encoding.FORMATS:
            raise Unsupported(f'no format "{fmt}"; this contract has {sorted(encoding.FORMATS)}')
        if fmt not in encoding.available_formats():
            raise Unsupported(f'this worker cannot produce "{fmt}": {encoding.why_unavailable(fmt)}')

        language = _optional_str(body, "language")
        if language is None:
            # The first the variant lists, so an adapter never receives "no language" and never has
            # to invent an answer for it.
            language = variant.languages[0] if variant.languages else "en"
        elif language not in variant.languages:
            raise Unsupported(
                f'variant "{variant_key}" does not speak "{language}"; it speaks '
                f"{', '.join(variant.languages) or 'nothing it declared'}"
            )

        delivery = _optional_str(body, "delivery")
        if delivery is not None and delivery not in variant.deliveries:
            # The core drops a delivery the variant did not claim before dispatch, so reaching here
            # means somebody is talking to the worker directly. Say so rather than ignoring it.
            raise Unsupported(
                f'variant "{variant_key}" does not perform "{delivery}"; '
                f"it performs {sorted(variant.deliveries) or 'nothing'}"
            )

        params = _validate_params(body.get("params"), variant.dials, variant_key)

        seed = body.get("seed")
        if seed is not None and not isinstance(seed, int):
            raise BadRequest("`seed` must be an integer")

        stream = body.get("stream", True)
        if not isinstance(stream, bool):
            raise BadRequest("`stream` must be a boolean")

        return SpeakRequest(
            text=text,
            voice=_voice(body),
            variant=variant_name,
            format=fmt,
            language=language,
            delivery=delivery,
            params=params,
            seed=seed,
            stream=stream,
        )

    def pcm(self, request: SpeakRequest) -> Iterator[bytes]:
        """The adapter's own output, still in its native format."""
        return self.engine.speak(request)

    def slots(self) -> asyncio.Semaphore:
        """Requests are serialised by default. One model, one utterance at a time is right for a GPU."""
        return self._slots

    def reject_if_draining(self) -> None:
        if self.draining:
            raise Overloaded("this worker is draining")

    def request_stop(self) -> None:
        """Finish what is in flight, then exit. The caller has already been answered."""
        self.stop()


def _license_document(declared: dict[str, Any]) -> dict[str, Any]:
    """Accept the `dict(code=..., weights_commercial_use=...)` form from the § 8 example."""
    if not declared:
        raise ValueError(
            "an engine must declare its licence: the weights licence is the one package metadata "
            "never reveals and the one that decides whether a commercial user may ship"
        )
    document = {
        "code": declared["code"],
        "weights": declared["weights"],
        "weightsCommercialUse": bool(
            declared.get("weights_commercial_use", declared.get("weightsCommercialUse", False))
        ),
    }
    notes = declared.get("notes")
    if notes:
        document["notes"] = notes
    return document


def _optional_str(body: dict[str, Any], key: str) -> str | None:
    value = body.get(key)
    if value is None:
        return None
    if not isinstance(value, str):
        raise BadRequest(f"`{key}` must be a string")
    return value


def _validate_params(
    params: Any, dials: dict[str, tuple[float, float, float]], variant: str
) -> dict[str, float]:
    """Unknown keys are refused, not ignored. protocol.md § 6.

    Ignoring them is wrong for the same reason a silently discarded dial is wrong: the client
    believes it asked for something. The message names the rejected key AND what the variant does
    have, because "a bug report delivered to the right person in under a second" is only true if it
    says what to send instead.
    """
    if params is None:
        return {}
    if not isinstance(params, dict):
        raise BadRequest("`params` must be an object")

    validated: dict[str, float] = {}
    for key, value in params.items():
        if key not in dials:
            available = ", ".join(sorted(dials)) or "none"
            raise BadRequest(f'variant "{variant}" has no dial "{key}"; it has {available}')
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise BadRequest(f'dial "{key}" takes a number')
        low, high, _ = dials[key]
        if not low <= float(value) <= high:
            raise BadRequest(f'dial "{key}" is {value} and takes {low} to {high}')
        validated[key] = float(value)
    return validated


__all__ = ["SUPPORTED_CONTRACTS", "Worker", "WorkerError"]


def _voice(body: dict[str, Any]) -> str | None:
    """The request's voice, checked as a name before an adapter turns it into a path."""
    voice = _optional_str(body, "voice")
    return None if voice is None else check_voice_id(voice)
