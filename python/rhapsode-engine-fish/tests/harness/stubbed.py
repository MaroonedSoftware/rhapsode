"""The Fish adapter, served for real, against a model that is not real.

Everything here is the actual adapter and the actual SDK: the socket, the handshake, the capability
document, the encoder, the error taxonomy and the residency verbs, and the adapter's own model thread.
Only torch, the hub and upstream's `fish_speech` are fakes (`stubs.py`). The source tree is one
already fetched, so nothing reaches GitHub.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

from harness.stubs import install

if __name__ == "__main__":
    install()

    from rhapsode_worker import serve

    from rhapsode_engine_fish import upstream
    from rhapsode_engine_fish.engine import FishEngine

    source = Path(tempfile.mkdtemp(prefix="fish-speech-"))
    (source / upstream.MARKER).write_text(upstream.TREE_DIGEST)
    os.environ["RHAPSODE_FISH_SOURCE"] = str(source)
    serve(FishEngine())
