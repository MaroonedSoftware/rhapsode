# Generated from contracts/rhapsode.types.ck, then reduced to models by
# scripts/contract.models.mjs. Do not edit manually.
#
# The client half of the generator's output is deliberately absent: it imports httpx, and the
# worker SDK has to install for an adapter that has no HTTP client library of its own.

from ._models_rhapsode_types import (
    Capabilities,
    Cloning,
    CoreHealth,
    CreateVoiceForm,
    CurrentVariant,
    Device,
    Dial,
    EngineIdentity,
    EngineSpeakRequest,
    EngineSummary,
    ErrorBody,
    ErrorDetail,
    License,
    LoadRequest,
    NativeFormat,
    ResidencySummary,
    SpeakRequest,
    Streaming,
    Variant,
    Voice,
    WorkerHealth,
)

__all__ = [
    "Capabilities",
    "Cloning",
    "CoreHealth",
    "CreateVoiceForm",
    "CurrentVariant",
    "Device",
    "Dial",
    "EngineIdentity",
    "EngineSpeakRequest",
    "EngineSummary",
    "ErrorBody",
    "ErrorDetail",
    "License",
    "LoadRequest",
    "NativeFormat",
    "ResidencySummary",
    "SpeakRequest",
    "Streaming",
    "Variant",
    "Voice",
    "WorkerHealth",
]
