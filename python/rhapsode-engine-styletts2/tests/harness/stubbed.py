"""The StyleTTS 2 adapter, served for real, against a model that is not real.

Everything here is the actual adapter and the actual SDK: the socket, the handshake, the capability
document, the encoder, the error taxonomy and the residency verbs. Only the synthesiser and the hub
are fakes (`stubs.py`). The source tree is one already fetched, so nothing reaches GitHub.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

from harness.stubs import install

if __name__ == "__main__":
    install()

    from rhapsode_worker import serve

    from rhapsode_engine_styletts2 import upstream
    from rhapsode_engine_styletts2.engine import StyleTTS2Engine

    source = Path(tempfile.mkdtemp(prefix="styletts2-")) / "source"
    source.mkdir()
    (source / upstream.MARKER).write_text(upstream.TREE_DIGEST)
    os.environ["RHAPSODE_STYLETTS2_SOURCE"] = str(source)
    serve(StyleTTS2Engine())
