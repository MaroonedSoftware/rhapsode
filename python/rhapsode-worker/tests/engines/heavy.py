"""The tone engine, but its model costs something a measurement can see.

`RHAPSODE_TEST_DECLARED` makes it answer `memory_bytes` itself, which is the hook an adapter uses
when it knows better than the SDK's delta.
"""

from __future__ import annotations

import os

from rhapsode_engine_tone.engine import ToneEngine

from rhapsode_worker import serve

#: Large enough to clear the noise in a resident-set reading, small enough to be free to allocate.
WEIGHTS_BYTES = 64 * 1024 * 1024


class HeavyEngine(ToneEngine):
    id = "heavy"
    display_name = "Heavy"

    def __init__(self) -> None:
        super().__init__()
        self._weights: bytearray | None = None

    def load(self, variant: str) -> None:
        super().load(variant)
        # Written to rather than merely sized, or the pages are never faulted in and the resident
        # set does not move.
        self._weights = bytearray(WEIGHTS_BYTES)
        for offset in range(0, WEIGHTS_BYTES, 4096):
            self._weights[offset] = 1

    def unload(self) -> None:
        self._weights = None
        super().unload()

    def memory_bytes(self) -> int | None:
        declared = os.environ.get("RHAPSODE_TEST_DECLARED")
        return int(declared) if declared else None


if __name__ == "__main__":
    serve(HeavyEngine())
