"""Engines that fail in each of the ways the protocol has an opinion about."""

from __future__ import annotations

import os
import struct
import time
from collections.abc import Iterator
from typing import Any, ClassVar

from rhapsode_worker import Engine, NativeFormat, SpeakRequest, Variant, Voice, serve

CHUNK = struct.pack("<2400h", *([0] * 2400))  # 100ms of silence at 24kHz

#: How the engine should misbehave, chosen by the environment so one module covers every case.
MODE = os.environ.get("RHAPSODE_TEST_MODE", "ok")

#: Written to when a request is cancelled, so a test can prove the engine stopped rather than ran on.
PROGRESS_FILE = os.environ.get("RHAPSODE_TEST_PROGRESS")


class FailingEngine(Engine):
    id = "failing"
    display_name = "Failing"
    license: ClassVar[dict[str, Any]] = {"code": "MIT", "weights": "MIT", "weights_commercial_use": True}
    native_format = NativeFormat(sample_rate=24_000, channels=1)

    def variants(self) -> dict[str, Variant]:
        return {"only": Variant()}

    #: Counts load attempts, so a test can tell "tried twice" from "tried once and got lucky".
    _attempts = 0

    def load(self, variant: str) -> None:
        type(self)._attempts += 1
        if MODE == "load_oom":
            raise RuntimeError("CUDA error: out of memory")
        if MODE == "load_oom_once" and type(self)._attempts == 1:
            # What a card that was briefly full looks like: the first load strands its partial
            # allocations, and the retry after an unload succeeds.
            raise RuntimeError("CUDA error: out of memory")

    def unload(self) -> None:
        if MODE == "unload_throws":
            raise RuntimeError("the adapter's unload threw")

    def voices(self) -> list[Voice]:
        return [Voice(id="one", label="One", spec="one@only")]

    def speak(self, request: SpeakRequest) -> Iterator[bytes]:
        if MODE == "raise_before_any_audio":
            raise RuntimeError("the adapter threw on entry")

        if MODE == "tiny":
            # Smaller than the core's 256-byte floor, which is the shape of a server answering 200
            # with a JSON complaint. It airs as a click and nothing notices until the end.
            yield b"\x00\x00" * 8
            return

        if MODE == "raise_mid_stream":
            yield CHUNK
            yield CHUNK
            raise RuntimeError("CUDA error: out of memory")

        if MODE == "slow":
            # Long enough that a test can hang up in the middle of it.
            for index in range(200):
                if PROGRESS_FILE:
                    with open(PROGRESS_FILE, "w") as handle:
                        handle.write(str(index))
                time.sleep(0.02)
                yield CHUNK
            return

        for _ in range(10):
            yield CHUNK


if __name__ == "__main__":
    serve(FailingEngine())
