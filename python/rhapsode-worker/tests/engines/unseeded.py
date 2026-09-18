"""An engine whose output differs on every call, seed or no seed, the way a sampling model's does.

It claims a cue and a delivery and performs neither. Before the conformance suite held a seed fixed,
this engine passed both comparisons, because two calls always differ. Now they cannot be decided,
and the suite has to say so rather than report them as passed.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from typing import Any, ClassVar

from rhapsode_worker import Engine, NativeFormat, SpeakRequest, Variant, Voice, serve


class UnseededEngine(Engine):
    id = "unseeded"
    display_name = "Unseeded"
    license: ClassVar[dict[str, Any]] = {"code": "MIT", "weights": "MIT", "weights_commercial_use": True}
    native_format = NativeFormat(sample_rate=24_000, channels=1)

    def variants(self) -> dict[str, Variant]:
        return {"only": Variant(cues=("laugh",), deliveries=("hushed",))}

    def load(self, variant: str) -> None:
        pass

    def unload(self) -> None:
        pass

    def voices(self) -> list[Voice]:
        return [Voice(id="one", label="One", spec="one@only")]

    def speak(self, request: SpeakRequest) -> Iterator[bytes]:
        # Length follows the text, as a real model's does, so the only thing wrong with this engine
        # is the thing under test: the content is fresh noise on every call and ignores the cue, the
        # delivery and the seed.
        for _ in range(max(2, len(request.text) // 4)):
            yield os.urandom(4800)


if __name__ == "__main__":
    serve(UnseededEngine())
