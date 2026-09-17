"""What makes a worker a worker.

Every check here is a rule from `docs/protocol.md`, and each says which one. They run against a URL,
so a worker on a unix socket and a worker on another machine are the same thing to this file, which
is the same property § 1 claims for the core.

The one rule nothing here can fully check is the honesty requirement in § 8: an adapter must claim
only what its loaded variant can actually perform. What it CAN check is that a claim changes the
audio, which catches the common case of a cue or a delivery wired to nothing.
"""

from __future__ import annotations

import wave
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from io import BytesIO
from typing import Any

from ._generated._models_rhapsode_types import Capabilities, Voice, WorkerHealth
from .client import Worker

#: Below this a body is not audio, whatever the status said. The core applies the same floor, and
#: for the same reason: a 200 carrying a JSON complaint airs as a click.
MIN_PLAUSIBLE_AUDIO_BYTES = 256


@dataclass
class Result:
    name: str
    section: str
    passed: bool
    detail: str = ""


@dataclass
class Report:
    results: list[Result] = field(default_factory=list)

    def record(self, name: str, section: str, passed: bool, detail: str = "") -> None:
        self.results.append(Result(name=name, section=section, passed=passed, detail=detail))

    @property
    def failures(self) -> list[Result]:
        return [result for result in self.results if not result.passed]

    @property
    def ok(self) -> bool:
        return not self.failures


Check = Callable[[Worker, Report], None]

CHECKS: list[Check] = []


def check(func: Check) -> Check:
    CHECKS.append(func)
    return func


def _audio_seconds(body: bytes) -> float | None:
    try:
        with wave.open(BytesIO(body)) as parsed:
            return float(parsed.getnframes()) / float(parsed.getframerate())
    except Exception:  # noqa: BLE001 - not a WAV, which several formats legitimately are not
        return None


# --------------------------------------------------------------------------- the capability document


@check
def health_answers_while_nothing_is_loaded(worker: Worker, report: Report) -> None:
    """§ 3. A health endpoint that waits on the thing it reports about times out when you need it."""
    worker.post("/unload")
    status, body = worker.get("/health")
    ok = status == 200
    if ok:
        health = WorkerHealth.model_validate(body)
        ok = health.model == "unloaded"
    report.record("health answers while unloaded", "§ 3", ok, f"status {status}")


@check
def capabilities_match_the_contract(worker: Worker, report: Report) -> None:
    """§ 4. Parsed against the generated model, so this is the contract checking itself."""
    status, body = worker.get("/capabilities")
    try:
        Capabilities.model_validate(body)
        report.record("capabilities parse against the contract", "§ 4", status == 200)
    except Exception as error:  # noqa: BLE001 - the message is the useful part
        report.record("capabilities parse against the contract", "§ 4", False, str(error)[:300])


@check
def current_is_absent_until_something_is_resident(worker: Worker, report: Report) -> None:
    """§ 4 as amended. An invented answer is worse than no answer."""
    worker.post("/unload")
    _, unloaded = worker.get("/capabilities")
    absent = unloaded.get("current") is None

    worker.post("/load", {})
    _, loaded = worker.get("/capabilities")
    present = isinstance(loaded.get("current"), dict)

    report.record(
        "current is absent while unloaded and present once loaded",
        "§ 4",
        absent and present,
        f"absent={absent} present={present}",
    )


@check
def both_licences_are_named(worker: Worker, report: Report) -> None:
    """§ 4. The weights licence is the one that decides whether a commercial user may ship."""
    _, capabilities = worker.get("/capabilities")
    licence = capabilities.get("license") or {}
    report.record(
        "the licence names code and weights separately",
        "§ 4",
        bool(licence.get("code")) and bool(licence.get("weights")) and "weightsCommercialUse" in licence,
        str(licence)[:200],
    )


@check
def every_variant_declares_the_three_lists(worker: Worker, report: Report) -> None:
    """§ 4. A variant missing one of them cannot be reasoned about by a client."""
    _, capabilities = worker.get("/capabilities")
    variants: dict[str, Any] = capabilities.get("variants") or {}
    missing = [
        name
        for name, variant in variants.items()
        if not all(key in variant for key in ("cues", "deliveries", "dials"))
    ]
    report.record(
        "every variant declares cues, deliveries and dials",
        "§ 4",
        bool(variants) and not missing,
        f"incomplete: {missing}" if missing else f"{len(variants)} variant(s)",
    )


# --------------------------------------------------------------------------- speaking


@check
def speak_loads_on_demand(worker: Worker, report: Report) -> None:
    """§ 3. It does not fail with "no model loaded" and does not require /load first."""
    worker.post("/unload")
    status, body = worker.speak({"text": "loading on demand", "stream": False})
    report.record(
        "speak loads on demand",
        "§ 3",
        status == 200 and len(body) >= MIN_PLAUSIBLE_AUDIO_BYTES,
        f"status {status}, {len(body)} bytes",
    )


@check
def every_declared_format_produces_bytes(worker: Worker, report: Report) -> None:
    """§ 4. A format in `formats` that cannot be produced is the dishonesty this document is for."""
    _, capabilities = worker.get("/capabilities")
    for name in capabilities.get("formats") or []:
        status, body = worker.speak({"text": "a line to encode", "format": name, "stream": False})
        report.record(
            f"format {name} produces bytes",
            "§ 4",
            status == 200 and len(body) >= MIN_PLAUSIBLE_AUDIO_BYTES,
            f"status {status}, {len(body)} bytes",
        )


@check
def a_format_that_is_not_declared_is_refused(worker: Worker, report: Report) -> None:
    """§ 6. And the refusal says which format, so an operator knows what to install."""
    _, capabilities = worker.get("/capabilities")
    absent = [
        name for name in ("opus", "flac", "mp3", "wav") if name not in (capabilities.get("formats") or [])
    ]
    if not absent:
        report.record("an undeclared format is refused", "§ 6", True, "this worker declares them all")
        return

    status, body = worker.speak({"text": "x", "format": absent[0], "stream": False})
    error = _error_of(body)
    report.record(
        "an undeclared format is refused",
        "§ 6",
        status == 422 and error.get("code") == "unsupported",
        f"status {status}, {error.get('code')}",
    )


@check
def streaming_arrives_in_more_than_one_piece(worker: Worker, report: Report) -> None:
    """§ 6. A stream that arrives whole is a buffered response wearing a chunked header."""
    pieces = worker.speak_streaming(
        {"text": "a longer line so that this takes more than one chunk", "stream": True}
    )
    report.record(
        "a streamed body arrives in pieces",
        "§ 6",
        len(pieces) > 1,
        f"{len(pieces)} chunk(s), {sum(len(p) for p in pieces)} bytes",
    )


@check
def a_buffered_response_carries_its_length(worker: Worker, report: Report) -> None:
    """§ 6. `stream: false` buffers and sets Content-Length."""
    status, body, headers = worker.speak_with_headers({"text": "buffered", "stream": False})
    declared = headers.get("content-length")
    report.record(
        "a buffered response carries Content-Length",
        "§ 6",
        status == 200 and declared is not None and int(declared) == len(body),
        f"status {status}",
    )


@check
def longer_text_makes_more_audio(worker: Worker, report: Report) -> None:
    """Not in the spec, and the cheapest possible check that synthesis is real."""
    _, short = worker.speak({"text": "one", "format": "wav", "stream": False})
    _, long = worker.speak(
        {"text": "one two three four five six seven eight nine ten", "format": "wav", "stream": False}
    )
    report.record(
        "longer text makes more audio",
        "-",
        len(long) > len(short),
        f"{len(short)} -> {len(long)} bytes",
    )


# --------------------------------------------------------------------------- the standard vocabulary


@check
def a_claimed_cue_changes_the_audio(worker: Worker, report: Report) -> None:
    """§ 8. The only mechanical check on the one thing an adapter must get right by hand.

    Claiming a cue you cannot perform is what breaks the guarantee that an engine never reads the
    word "laugh" out loud. This cannot prove a cue was performed WELL, but a cue wired to nothing
    produces audio identical to the line without it, and that it can see.
    """
    for variant, claims in _variants(worker).items():
        for cue in claims.get("cues") or []:
            plain = worker.speak({"text": "a line", "variant": variant, "format": "wav", "stream": False})[1]
            cued = worker.speak(
                {"text": f"a [{cue}] line", "variant": variant, "format": "wav", "stream": False}
            )[1]
            report.record(
                f'cue "{cue}" changes the audio on variant "{variant}"',
                "§ 8",
                plain != cued,
                "identical audio, so the cue is claimed but not performed" if plain == cued else "",
            )


@check
def a_claimed_delivery_changes_the_audio(worker: Worker, report: Report) -> None:
    """§ 5 and § 8. Same argument, and the one that catches a delivery wired to nothing."""
    for variant, claims in _variants(worker).items():
        for delivery in claims.get("deliveries") or []:
            plain = worker.speak({"text": "a line", "variant": variant, "format": "wav", "stream": False})[1]
            spoken = worker.speak(
                {"text": "a line", "variant": variant, "delivery": delivery, "format": "wav", "stream": False}
            )[1]
            report.record(
                f'delivery "{delivery}" changes the audio on variant "{variant}"',
                "§ 5",
                plain != spoken,
                "identical audio, so the delivery is claimed but not performed" if plain == spoken else "",
            )


@check
def a_delivery_a_variant_does_not_claim_is_refused(worker: Worker, report: Report) -> None:
    """§ 5. The core drops these before dispatch, so reaching the worker means somebody went direct."""
    for variant, claims in _variants(worker).items():
        unclaimed = [word for word in ("hushed", "frantic") if word not in (claims.get("deliveries") or [])]
        if not unclaimed:
            continue
        status, _ = worker.speak(
            {"text": "x", "variant": variant, "delivery": unclaimed[0], "format": "wav", "stream": False}
        )
        report.record(
            f'an unclaimed delivery is refused on variant "{variant}"',
            "§ 5",
            status == 422,
            f"status {status}",
        )
        return
    report.record("an unclaimed delivery is refused", "§ 5", True, "every variant claims every delivery")


# --------------------------------------------------------------------------- the error taxonomy


@check
def an_unknown_dial_is_refused_and_names_the_key(worker: Worker, report: Report) -> None:
    """§ 6. Ignoring it is wrong because the client believes it asked for something."""
    status, body = worker.speak({"text": "x", "params": {"definitelyNotADial": 1}, "stream": False})
    error = _error_of(body)
    report.record(
        "an unknown dial is refused and named",
        "§ 6",
        status == 400
        and error.get("code") == "bad_request"
        and "definitelyNotADial" in str(error.get("message")),
        f"status {status}: {str(error.get('message'))[:120]}",
    )


@check
def an_unknown_variant_is_refused_rather_than_swapped(worker: Worker, report: Report) -> None:
    """Falling back produces audio the caller did not ask for and has no way to notice."""
    status, _ = worker.speak({"text": "x", "variant": "definitely-not-a-variant", "stream": False})
    report.record(
        "an unknown variant is refused",
        "§ 6",
        status in (400, 422),
        f"status {status}",
    )


@check
def every_error_carries_a_retryable_flag(worker: Worker, report: Report) -> None:
    """§ 6. A caller that infers it from the status either retries forever or discards good work."""
    bad: list[dict[str, Any]] = [
        {"text": ""},
        {"text": "x", "variant": "definitely-not-a-variant"},
        {"text": "x", "params": {"definitelyNotADial": 1}},
    ]
    problems: list[dict[str, Any]] = []
    for body in bad:
        _, raw = worker.speak({**body, "stream": False})
        error = _error_of(raw)
        if set(error) != {"code", "message", "retryable"} or not isinstance(error.get("retryable"), bool):
            problems.append(error)
    report.record(
        "every error envelope is code, message and retryable", "§ 6", not problems, str(problems)[:200]
    )


@check
def text_past_the_ceiling_is_refused(worker: Worker, report: Report) -> None:
    """§ 6. A worker that accepts anything has a maxCharacters nobody can rely on."""
    _, capabilities = worker.get("/capabilities")
    current = capabilities.get("current") or {}
    ceiling = current.get("maxCharacters")
    if not isinstance(ceiling, int):
        report.record("text past maxCharacters is refused", "§ 6", True, "no ceiling declared")
        return

    status, _ = worker.speak({"text": "x" * (ceiling + 1), "stream": False})
    report.record("text past maxCharacters is refused", "§ 6", status == 400, f"status {status}")


# --------------------------------------------------------------------------- voices and residency


@check
def voices_carry_a_spec_and_a_preview_url(worker: Worker, report: Report) -> None:
    """§ 7. Keyed on the id instead, a remapped voice serves its old preview forever."""
    status, body = worker.get("/voices")
    problems = []
    for entry in body if isinstance(body, list) else []:
        try:
            voice = Voice.model_validate(entry)
            if not voice.spec:
                problems.append(f"{voice.id}: no spec")
        except Exception as error:  # noqa: BLE001
            problems.append(str(error)[:120])
    report.record("voices parse and carry a spec", "§ 7", status == 200 and not problems, str(problems)[:200])


@check
def unloading_nothing_is_a_success(worker: Worker, report: Report) -> None:
    """§ 3. The core unloads on a schedule it owns and cannot know what a crash left behind."""
    statuses = [worker.post("/unload")[0] for _ in range(3)]
    report.record("unload is idempotent", "§ 3", set(statuses) == {200}, str(statuses))


def _variants(worker: Worker) -> dict[str, Any]:
    _, capabilities = worker.get("/capabilities")
    variants = capabilities.get("variants")
    return variants if isinstance(variants, dict) else {}


def _error_of(body: bytes) -> dict[str, Any]:
    import json

    try:
        parsed = json.loads(body)
    except ValueError:
        return {}
    return parsed.get("error", {}) if isinstance(parsed, dict) else {}


def run(worker: Worker) -> Report:
    report = Report()
    for one in CHECKS:
        try:
            one(worker, report)
        except Exception as error:  # noqa: BLE001 - a check that throws is a failed check
            report.record(one.__name__.replace("_", " "), "-", False, f"the check itself raised: {error}")
    return report


def iter_checks() -> Iterator[str]:
    return iter(one.__name__ for one in CHECKS)
