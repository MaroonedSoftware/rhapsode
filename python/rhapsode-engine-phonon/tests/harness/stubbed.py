"""The Phonon adapter, served for real, against a model that is not real.

The adapter and the SDK are the actual ones: socket, handshake, capability document, encoder, error
taxonomy, residency verbs. Only the runtime and the download are stubbed.
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

from harness import stub

if __name__ == "__main__":
    stub.install(Path(tempfile.gettempdir()))

    from rhapsode_worker import serve

    from rhapsode_engine_phonon.engine import PhononEngine
    from rhapsode_engine_phonon.forty import Phonon40mEngine

    serve(Phonon40mEngine() if sys.argv[1:] == ["40m"] else PhononEngine())
