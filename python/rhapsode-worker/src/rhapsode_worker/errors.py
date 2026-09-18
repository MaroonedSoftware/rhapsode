"""The error taxonomy. protocol.md § 6.

`retryable` is a field rather than something a caller infers from the status, because the
distinction that matters is between "this request was wrong" and "this request was fine and the
server was not". A caller that conflates them either retries a permanent failure forever or
discards work that would have succeeded on the next pass.
"""

from __future__ import annotations

from typing import Any


class WorkerError(Exception):
    """Base for everything the SDK turns into an error envelope."""

    code = "internal"
    status = 500
    retryable = False

    def envelope(self) -> dict[str, Any]:
        return {"error": {"code": self.code, "message": str(self), "retryable": self.retryable}}


class BadRequest(WorkerError):
    code = "bad_request"
    status = 400


class UnknownVoice(WorkerError):
    code = "unknown_voice"
    status = 404


class Unsupported(WorkerError):
    """A format, a language or a feature this variant does not do."""

    code = "unsupported"
    status = 422


class ModelUnavailable(WorkerError):
    """Loading, evicted, or a load that ran out of time. Worth another try."""

    code = "model_unavailable"
    status = 503
    retryable = True


class OutOfMemory(WorkerError):
    code = "oom"
    status = 503
    retryable = True


class Overloaded(WorkerError):
    """Draining, or at the concurrency limit."""

    code = "overloaded"
    status = 429
    retryable = True


class Internal(WorkerError):
    """The adapter threw something the SDK could not classify."""

    code = "internal"
    status = 500


#: Substrings that mean a device ran out of memory, whichever framework said so. An OOM misfiled as
#: `internal` is the difference between a caller keeping the job and writing it off, and every
#: framework spells it differently enough that matching on the type alone misses most of them.
_OOM_MARKERS = (
    "out of memory",
    "cuda error: out of memory",
    "cudaerrormemoryallocation",
    "mps backend out of memory",
    "hip out of memory",
)


def classify(error: BaseException) -> WorkerError:
    """Map whatever an adapter raised onto the taxonomy, with `retryable` set correctly."""
    if isinstance(error, WorkerError):
        return error
    if isinstance(error, MemoryError):
        return OutOfMemory(str(error) or "out of memory")

    text = str(error).lower()
    if any(marker in text for marker in _OOM_MARKERS):
        return OutOfMemory(str(error))

    if isinstance(error, NotImplementedError):
        return Unsupported(str(error) or "not supported by this engine")
    if isinstance(error, (ValueError, TypeError, KeyError)):
        return BadRequest(str(error))

    return Internal(f"{type(error).__name__}: {error}")
