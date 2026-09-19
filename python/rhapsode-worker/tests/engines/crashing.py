"""The tone engine, except that listing voices or making one raises a plain ValueError.

What an adapter raises when a library under it refuses something: numpy's `allow_pickle=False`
refusal is a ValueError, and it is how the connection drop this engine exists for was found.
"""

from __future__ import annotations

from rhapsode_engine_tone.engine import ToneEngine

from rhapsode_worker import CreateVoiceRequest, Voice, serve


class CrashingEngine(ToneEngine):
    id = "crashing"
    display_name = "Crashing"

    def voices(self) -> list[Voice]:
        raise ValueError("the voice store is not what this adapter expected")

    def create_voice(self, request: CreateVoiceRequest) -> Voice:
        raise ValueError("This file contains pickled (object) data.")


if __name__ == "__main__":
    serve(CrashingEngine())
