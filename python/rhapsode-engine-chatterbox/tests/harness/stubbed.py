"""The Chatterbox adapter, served for real, against a model that is not real.

Everything here is the actual adapter and the actual SDK: the socket, the handshake, the capability
document, the encoder, the error taxonomy and the residency verbs. Only the three upstream classes
are stubs, because the real ones bring torch and several gigabytes of weights.

What running `rhapsode-conform` against this proves is that the adapter's protocol surface is
correct: that the two-level capability document is well formed, that turbo declares cues and no
dials while the dialled builds declare the reverse, that a request's text and dials reach the model,
and that every refusal is the right code with the right retryable flag.

What it cannot prove is that the turbo weights actually perform a laugh. Nothing short of the real
weights can, and `rhapsode-conform` against a real install is where that gets asked.
"""

from __future__ import annotations

import sys
import types
from typing import Any

import numpy as np


class _Build:
    def __init__(self, name: str) -> None:
        self.name = name

    def generate(self, text: str, **arguments: Any) -> Any:
        digest = abs(hash((text, tuple(sorted(map(str, arguments.items())))))) % 997
        samples = max(4_800, len(text) * 1_200)
        ramp = np.linspace(-0.5, 0.5, samples, dtype="float32")
        return (ramp * (1.0 - digest / 2_000.0)).reshape(1, -1)


class _Factory:
    def __init__(self, name: str) -> None:
        self._name = name

    def from_pretrained(self, device: Any) -> _Build:
        del device
        return _Build(self._name)


def install() -> None:
    torch = types.ModuleType("torch")
    torch.device = lambda name: f"device:{name}"  # type: ignore[attr-defined]
    torch.manual_seed = lambda seed: None  # type: ignore[attr-defined]
    torch.cuda = types.SimpleNamespace(  # type: ignore[attr-defined]
        is_available=lambda: False, empty_cache=lambda: None, manual_seed_all=lambda seed: None
    )
    torch.backends = types.SimpleNamespace(mps=types.SimpleNamespace(is_available=lambda: False))  # type: ignore[attr-defined]
    torch.mps = types.SimpleNamespace(empty_cache=lambda: None)  # type: ignore[attr-defined]

    # A fetch that downloads nothing, so the conformance suite's fetch check sees a success here
    # rather than an import error. Whether the real download works is a question for real weights.
    hub = types.ModuleType("huggingface_hub")
    hub.snapshot_download = lambda **arguments: ""  # type: ignore[attr-defined]
    sys.modules["huggingface_hub"] = hub

    tts = types.ModuleType("chatterbox.tts")
    tts.ChatterboxTTS = _Factory("original")  # type: ignore[attr-defined]
    turbo = types.ModuleType("chatterbox.tts_turbo")
    turbo.ChatterboxTurboTTS = _Factory("turbo")  # type: ignore[attr-defined]
    mtl = types.ModuleType("chatterbox.mtl_tts")
    mtl.ChatterboxMultilingualTTS = _Factory("multilingual")  # type: ignore[attr-defined]

    sys.modules.update(
        {
            "torch": torch,
            "chatterbox": types.ModuleType("chatterbox"),
            "chatterbox.tts": tts,
            "chatterbox.tts_turbo": turbo,
            "chatterbox.mtl_tts": mtl,
        }
    )


if __name__ == "__main__":
    install()

    from rhapsode_worker import serve

    from rhapsode_engine_chatterbox.engine import ChatterboxEngine

    serve(ChatterboxEngine())
