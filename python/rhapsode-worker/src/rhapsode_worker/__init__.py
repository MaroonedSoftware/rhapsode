"""The rhapsode worker SDK.

An adapter author installs one package, writes one class, and never learns what the core is written
in. See `docs/protocol.md` § 8.
"""

from .blends import parse_blend
from .engine import (
    BlendRequest,
    CreateVoiceRequest,
    Device,
    DialogueRequest,
    DialogueTurn,
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
from .text import segments

#: The contract major this SDK speaks. protocol.md § 9.
CONTRACT = 1

__all__ = [
    "CONTRACT",
    "BadRequest",
    "BlendRequest",
    "CreateVoiceRequest",
    "Device",
    "DialogueRequest",
    "DialogueTurn",
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
    "parse_blend",
    "segments",
    "serve",
]
