"""The Kokoro adapter, served for real, against a model that is not real.

The adapter and the SDK are the actual ones: socket, handshake, capability document, encoder, error
taxonomy, residency verbs. The model is a stub and the weights are a few bytes each, with sizes and
hashes to match, so `fetch` and `load` run the real download and verification code without a network.
"""

from __future__ import annotations

import hashlib
import io
from pathlib import Path

from harness import stub
from rhapsode_engine_kokoro import weights


def fake_weights() -> None:
    """Replace each asset with a few bytes, and the network with something that serves them."""
    contents = {
        asset.name: f"not really {asset.name}".encode()
        for asset in [*weights.MODELS.values(), weights.VOICES]
    }

    def asset(real: weights.Asset) -> weights.Asset:
        body = contents[real.name]
        return weights.Asset(real.name, len(body), hashlib.sha256(body).hexdigest())

    weights.MODELS = {name: asset(model) for name, model in weights.MODELS.items()}
    weights.VOICES = asset(weights.VOICES)
    weights._open = lambda url: io.BytesIO(contents[Path(url).name])


if __name__ == "__main__":
    stub.install()
    fake_weights()

    from rhapsode_worker import serve

    from rhapsode_engine_kokoro.engine import KokoroEngine

    serve(KokoroEngine())
