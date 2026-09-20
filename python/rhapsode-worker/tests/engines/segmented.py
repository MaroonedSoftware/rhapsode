"""An engine that splits nothing itself and records what the SDK handed it.

The point of the SDK's splitting is that `speak()` stays a function about one thing, so this engine
is the shape an adapter is supposed to end up: it reads `request.text`, says it, and never learns
that the request it came from was longer.
"""

from __future__ import annotations

import json
import os
from collections.abc import Iterator
from typing import Any, ClassVar

from rhapsode_worker import Engine, NativeFormat, SpeakRequest, Variant, Voice, serve

#: Short, so a test's text is several pieces without being long enough to be slow.
SEGMENT_CHARACTERS = 40

#: 50 ms at 24 kHz mono is 2400 bytes of silence between two pieces.
SEGMENT_PAUSE_MS = 50

#: What one call yields, whatever it was given: the audio a test counts is pieces, not characters.
BYTES_PER_PIECE = 4800


class SegmentedEngine(Engine):
    id = "segmented"
    display_name = "Segmented"
    license: ClassVar[dict[str, Any]] = {"code": "MIT", "weights": "MIT", "weights_commercial_use": True}
    native_format = NativeFormat(sample_rate=24_000, channels=1)
    segment_characters = SEGMENT_CHARACTERS
    segment_pause_ms = SEGMENT_PAUSE_MS

    def variants(self) -> dict[str, Variant]:
        return {"only": Variant()}

    def load(self, variant: str) -> None:
        pass

    def unload(self) -> None:
        pass

    def voices(self) -> list[Voice]:
        return [Voice(id="one", label="One", spec="one@only")]

    def speak(self, request: SpeakRequest) -> Iterator[bytes]:
        record = os.environ.get("RHAPSODE_TEST_RECORD")
        if record:
            with open(record, "a", encoding="utf-8") as handle:
                handle.write(json.dumps({"text": request.text, "seed": request.seed}) + "\n")
        yield bytes(BYTES_PER_PIECE)


if __name__ == "__main__":
    serve(SegmentedEngine())
