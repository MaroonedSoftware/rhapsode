"""An engine that clones from a reference and its transcript, and says back which words it was given.

The only way to see from outside the worker that the transcript reached the adapter, and reached it
as the client wrote it.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any, ClassVar

from rhapsode_worker import (
    BadRequest,
    CreateVoiceRequest,
    Engine,
    NativeFormat,
    SpeakRequest,
    Variant,
    Voice,
    serve,
)


class TranscribedEngine(Engine):
    id = "transcribed"
    display_name = "Transcribed"
    license: ClassVar[dict[str, Any]] = {"code": "MIT", "weights": "MIT", "weights_commercial_use": True}
    native_format = NativeFormat(sample_rate=24_000, channels=1)

    def variants(self) -> dict[str, Variant]:
        return {"only": Variant(cues=(), deliveries=())}

    def load(self, variant: str) -> None:
        pass

    def unload(self) -> None:
        pass

    def voices(self) -> list[Voice]:
        return []

    def create_voice(self, request: CreateVoiceRequest) -> Voice:
        if request.transcript is None:
            raise BadRequest("`transcript` is required: the words spoken in the reference")
        return Voice(id=request.id, label=request.id, description=request.transcript, spec=request.id)

    def speak(self, request: SpeakRequest) -> Iterator[bytes]:
        yield b"\x00\x00" * 24_000


if __name__ == "__main__":
    serve(TranscribedEngine())
