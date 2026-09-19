"""The tone engine, taking only one type of reference, so the SDK's refusal of any other can be seen.

The real engines that declare a type are Kokoro, whose weights are too large for these tests, and
Chatterbox, which needs torch.
"""

from __future__ import annotations

from rhapsode_engine_tone.engine import ToneEngine

from rhapsode_worker import serve


class PickyEngine(ToneEngine):
    id = "picky"
    display_name = "Picky"

    def reference_formats(self) -> tuple[str, ...]:
        return ("npy",)


if __name__ == "__main__":
    serve(PickyEngine())
