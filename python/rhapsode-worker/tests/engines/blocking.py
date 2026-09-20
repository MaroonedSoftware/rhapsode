"""An engine whose synthesis is one long blocking call, the shape of a model's `generate()`.

Nothing can interrupt it: a client that hangs up stops the stream at the next chunk, and there is no
next chunk until the call returns. It logs when each thing happens, so a test can prove that nothing
touched the device while it was still running.
"""

from __future__ import annotations

import os
import struct
import time
from collections.abc import Iterator
from typing import Any, ClassVar

from rhapsode_worker import Engine, NativeFormat, SpeakRequest, Variant, Voice, serve

CHUNK = struct.pack("<2400h", *([0] * 2400))  # 100ms of silence at 24kHz

#: Where each event is written, one line each, as it happens.
EVENTS = os.environ["RHAPSODE_TEST_EVENTS"]

#: How long the one blocking call takes.
SECONDS = float(os.environ.get("RHAPSODE_TEST_SECONDS", "2"))


def event(name: str) -> None:
    with open(EVENTS, "a") as events:
        events.write(f"{time.monotonic():.3f} {name}\n")


class BlockingEngine(Engine):
    id = "blocking"
    display_name = "Blocking"
    license: ClassVar[dict[str, Any]] = {"code": "MIT", "weights": "MIT", "weights_commercial_use": True}
    native_format = NativeFormat(sample_rate=24_000, channels=1)

    def variants(self) -> dict[str, Variant]:
        return {"only": Variant(), "other": Variant()}

    def load(self, variant: str) -> None:
        event(f"load {variant}")

    def unload(self) -> None:
        event("unload")

    def voices(self) -> list[Voice]:
        return []

    def speak(self, request: SpeakRequest) -> Iterator[bytes]:
        event("speak begins")
        time.sleep(SECONDS)
        event("speak ends")
        yield CHUNK * 3


if __name__ == "__main__":
    serve(BlockingEngine())
