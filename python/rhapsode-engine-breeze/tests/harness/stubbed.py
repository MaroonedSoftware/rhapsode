"""The Breeze adapter, served for real, against a model that is not real.

Everything here is the actual adapter and the actual SDK: the socket, the handshake, the capability
document, the encoder, the error taxonomy and the residency verbs. Only torch, the hub and upstream's
runtime are fakes (`stubs.py`), and the fake torch reports a CUDA card, because the adapter declares
nothing on any other box.
"""

from __future__ import annotations

from harness.stubs import install

if __name__ == "__main__":
    install()

    from rhapsode_worker import serve

    from rhapsode_engine_breeze.engine import BreezeEngine

    serve(BreezeEngine())
