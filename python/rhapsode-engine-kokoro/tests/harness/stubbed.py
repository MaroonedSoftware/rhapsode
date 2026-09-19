"""The Kokoro adapter, served for real, against a model that is not real.

The adapter and the SDK are the actual ones: socket, handshake, capability document, encoder, error
taxonomy, residency verbs. The model is a stub and the graphs are a few bytes each, with sizes and
hashes to match, so `fetch` and `load` run the real download and verification code without a network.
The voices file is a real one, of constant vectors that compress to almost nothing, because a blend
reads it and the conformance suite makes one.
"""

from __future__ import annotations

import hashlib
import io
from pathlib import Path

import numpy as np

from harness import stub
from rhapsode_engine_kokoro import styles, weights
from rhapsode_engine_kokoro.engine import ENGLISH_VOICES


def fake_weights() -> None:
    """Replace each asset with a few bytes, and the network with something that serves them."""
    contents = {asset.name: f"not really {asset.name}".encode() for asset in weights.MODELS.values()}
    contents[weights.VOICES.name] = _voices_file()

    def asset(real: weights.Asset) -> weights.Asset:
        body = contents[real.name]
        return weights.Asset(real.name, len(body), hashlib.sha256(body).hexdigest())

    weights.MODELS = {name: asset(model) for name, model in weights.MODELS.items()}
    weights.VOICES = asset(weights.VOICES)
    weights._open = lambda url: io.BytesIO(contents[Path(url).name])


def _voices_file() -> bytes:
    buffer = io.BytesIO()
    vectors = {
        name: np.full(styles.SHAPE, index / 100, dtype=np.float32)
        for index, name in enumerate(ENGLISH_VOICES)
    }
    np.savez_compressed(buffer, **vectors)
    return buffer.getvalue()


if __name__ == "__main__":
    stub.install()
    fake_weights()

    from rhapsode_worker import serve

    from rhapsode_engine_kokoro.engine import KokoroEngine

    serve(KokoroEngine())
