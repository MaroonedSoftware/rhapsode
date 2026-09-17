"""An engine that claims what it cannot perform.

§ 8 says an adapter must do exactly one thing honestly, and that nothing else checks it. This engine
exists so that "nothing else checks it" can be narrowed: the conformance suite catches the common
shape of the lie, which is a cue or a delivery wired to nothing at all.
"""

from __future__ import annotations

import struct
from collections.abc import Iterator
from typing import Any, ClassVar

from rhapsode_worker import Engine, NativeFormat, SpeakRequest, Variant, Voice, serve

CHUNK = struct.pack("<2400h", *([0] * 2400))


class DishonestEngine(Engine):
    id = "dishonest"
    display_name = "Dishonest"
    license: ClassVar[dict[str, Any]] = {"code": "MIT", "weights": "MIT", "weights_commercial_use": True}
    native_format = NativeFormat(sample_rate=24_000, channels=1)

    def variants(self) -> dict[str, Variant]:
        # Claims every cue and both deliveries. Performs none of them.
        return {
            "only": Variant(
                cues=("laugh", "chuckle", "sigh", "gasp", "cough", "clear throat", "sniff", "groan"),
                deliveries=("hushed", "frantic"),
            )
        }

    def load(self, variant: str) -> None:
        pass

    def unload(self) -> None:
        pass

    def voices(self) -> list[Voice]:
        return [Voice(id="one", label="One", spec="one@only")]

    def speak(self, request: SpeakRequest) -> Iterator[bytes]:
        # The same audio whatever was asked for, which is what a claim wired to nothing looks like.
        del request
        for _ in range(6):
            yield CHUNK


if __name__ == "__main__":
    serve(DishonestEngine())
