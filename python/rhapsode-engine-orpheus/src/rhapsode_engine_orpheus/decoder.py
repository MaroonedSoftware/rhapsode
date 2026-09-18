"""SNAC codes to PCM."""

from __future__ import annotations

from typing import Any

from .builds import SNAC_REPOSITORY, SNAC_REVISION
from .codes import Window, layers


class SnacDecoder:
    """The 24 kHz SNAC codec, which is the only part of this engine that needs torch.

    On a CUDA card it runs beside the Llama, as upstream's does. Everywhere else it runs on the CPU:
    it is 80 MB and decodes four frames at a time, and MPS has not been measured against it yet.
    """

    def __init__(self, device: str) -> None:
        import torch
        from snac import SNAC

        self._torch: Any = torch
        self._device = device
        self._model: Any = SNAC.from_pretrained(SNAC_REPOSITORY, revision=SNAC_REVISION).eval().to(device)

    def decode(self, window: Window) -> bytes:
        torch = self._torch
        codes = [
            torch.tensor([layer], dtype=torch.int32, device=self._device) for layer in layers(window.codes)
        ]
        with torch.inference_mode():
            audio = self._model.decode(codes)
        return pcm(audio[0, 0, window.start : window.end].float().cpu().numpy())


def pcm(samples: Any) -> bytes:
    """A float waveform in [-1, 1] as little-endian signed 16-bit PCM.

    Clipped before scaling rather than after, because a value slightly outside the range wraps around
    to full scale of the opposite sign once it is an integer: a moment of loudness becomes a click.
    Upstream's decoder scales without clipping. The same rule as Chatterbox's adapter, copied rather
    than imported because one adapter must not depend on another.
    """
    import numpy as np

    clipped = np.clip(np.asarray(samples, dtype=np.float32).reshape(-1), -1.0, 1.0)
    return bytes((clipped * 32767.0).astype("<i2").tobytes())
