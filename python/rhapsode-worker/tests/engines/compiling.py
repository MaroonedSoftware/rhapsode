"""An engine with one variant that compiles on first load, standing in for whichever catalog engine
the core spawned it as, so an install test can watch the core warm it. protocol.md § 8 and § 10."""

from __future__ import annotations

import os
import struct
from collections.abc import Iterator
from typing import Any, ClassVar

from rhapsode_worker import Engine, NativeFormat, SpeakRequest, Variant, Voice, serve

CHUNK = struct.pack("<2400h", *([0] * 2400))  # 100ms of silence at 24kHz

#: Each fetch, load and unload, one line apiece, so a test can read the order they happened in.
PROGRESS_FILE = os.environ.get("RHAPSODE_TEST_PROGRESS")

#: Load fails, so a test can watch a warm that cannot happen.
MODE = os.environ.get("RHAPSODE_TEST_MODE", "ok")


def _note(line: str) -> None:
    if PROGRESS_FILE:
        with open(PROGRESS_FILE, "a") as progress:
            progress.write(f"{line}\n")


class CompilingEngine(Engine):
    # The id the core spawned it as, because the SDK refuses to start as anything else.
    id = os.environ.get("RHAPSODE_WORKER_ENGINE", "compiling")
    display_name = "Compiling"
    license: ClassVar[dict[str, Any]] = {"code": "MIT", "weights": "MIT", "weights_commercial_use": True}
    native_format = NativeFormat(sample_rate=24_000, channels=1)

    def variants(self) -> dict[str, Variant]:
        return {"compiled": Variant(compiles=True), "plain": Variant()}

    def fetch(self, variant: str) -> None:
        _note(f"fetched {variant}")

    def load(self, variant: str) -> None:
        if MODE == "load_fails":
            raise RuntimeError("the adapter's load threw")
        _note(f"loaded {variant}")

    def unload(self) -> None:
        _note("unloaded")

    def voices(self) -> list[Voice]:
        return [Voice(id="one", label="One", spec="one@compiled")]

    def speak(self, request: SpeakRequest) -> Iterator[bytes]:
        yield CHUNK


if __name__ == "__main__":
    serve(CompilingEngine())
