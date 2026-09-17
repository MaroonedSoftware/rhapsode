"""An engine whose adapter prints, which is the thing § 2 says must not be able to break anything."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any, ClassVar

from rhapsode_worker import Engine, NativeFormat, SpeakRequest, Variant, Voice, serve


class NoisyEngine(Engine):
    id = "noisy"
    display_name = "Noisy"
    license: ClassVar[dict[str, Any]] = {"code": "MIT", "weights": "MIT", "weights_commercial_use": True}
    native_format = NativeFormat(sample_rate=24_000, channels=1)

    def variants(self) -> dict[str, Variant]:
        return {"only": Variant()}

    def load(self, variant: str) -> None:
        print("a print from load()")

    def unload(self) -> None:
        pass

    def voices(self) -> list[Voice]:
        print("a print that would have corrupted the handshake")
        return [Voice(id="one", label="One", spec="one@only")]

    def speak(self, request: SpeakRequest) -> Iterator[bytes]:
        yield b"\x00\x00" * 2000


if __name__ == "__main__":
    serve(NoisyEngine())
