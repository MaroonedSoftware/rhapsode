"""The Dia adapter, served for real, against a model that is not real.

Everything here is the actual adapter and the actual SDK: the socket, the handshake, the capability
document, the encoder, the error taxonomy and the residency verbs. Only torch, transformers and the
hub are fakes (`stubs.py`), because the real ones bring gigabytes.
"""

from __future__ import annotations

from harness.stubs import install

if __name__ == "__main__":
    install()

    from rhapsode_worker import serve

    from rhapsode_engine_dia.engine import DiaEngine

    serve(DiaEngine())
