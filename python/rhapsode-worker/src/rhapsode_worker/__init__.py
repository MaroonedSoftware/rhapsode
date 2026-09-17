"""The rhapsode worker SDK.

An adapter author installs one package, writes one class, and never learns what the core is written
in. See `docs/protocol.md` § 8.
"""

from .engine import (
    CreateVoiceRequest,
    Device,
    Engine,
    NativeFormat,
    SpeakRequest,
    Variant,
    Voice,
)
from .errors import (
    BadRequest,
    Internal,
    ModelUnavailable,
    OutOfMemory,
    Overloaded,
    UnknownVoice,
    Unsupported,
    WorkerError,
)
from .log import Log
from .serve import serve

#: The contract major this SDK speaks. protocol.md § 9.
CONTRACT = 1

__all__ = [
    "CONTRACT",
    "BadRequest",
    "CreateVoiceRequest",
    "Device",
    "Engine",
    "Internal",
    "Log",
    "ModelUnavailable",
    "NativeFormat",
    "OutOfMemory",
    "Overloaded",
    "SpeakRequest",
    "UnknownVoice",
    "Unsupported",
    "Variant",
    "Voice",
    "WorkerError",
    "serve",
]
