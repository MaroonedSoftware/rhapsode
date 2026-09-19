"""`.pt` voicepacks built the way `torch.save` writes them, without torch.

The two pickles are copied byte for byte from Kokoro-FastAPI's own packs, because their layouts are
what the reader has to get right: af_bella.pt's tensor starts at the beginning of its storage, and
am_v0gurney.pt's is a view 256 floats into a storage one row longer.
"""

from __future__ import annotations

import io
import os
import pickle
import zipfile
from typing import Any

import numpy as np

#: af_bella.pt: a 130,560-float storage, offset 0.
AT_START = (
    b"\x80\x02ctorch._utils\n_rebuild_tensor_v2\nq\x00((X\x07\x00\x00\x00storageq\x01ctorch\nFloatStorage\n"
    b"q\x02X\x01\x00\x00\x000q\x03X\x03\x00\x00\x00cpuq\x04J\x00\xfe\x01\x00tq\x05QK\x00M\xfe\x01K\x01M\x00"
    b"\x01\x87q\x06M\x00\x01M\x00\x01K\x01\x87q\x07\x89ccollections\nOrderedDict\nq\x08)Rq\ttq\nRq\x0b."
)

#: am_v0gurney.pt: a 130,816-float storage, offset 256.
OFFSET = (
    b"\x80\x02ctorch._utils\n_rebuild_tensor_v2\nq\x00((X\x07\x00\x00\x00storageq\x01ctorch\nFloatStorage\n"
    b"q\x02X\x01\x00\x00\x000q\x03X\x03\x00\x00\x00cpuq\x04J\x00\xff\x01\x00tq\x05QM\x00\x01M\xfe\x01K\x01M"
    b"\x00\x01\x87q\x06M\x00\x01M\x00\x01K\x01\x87q\x07\x89ccollections\nOrderedDict\nq\x08)Rq\ttq\nRq\x0b."
)

ROWS = 510 * 256


def style(seed: int = 0) -> Any:
    return np.random.default_rng(seed).standard_normal((510, 1, 256)).astype(np.float32)


def voicepack(pickled: bytes, storage: bytes, name: str = "am_x", byteorder: bytes = b"little") -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_STORED) as archive:
        archive.writestr(f"{name}/data.pkl", pickled)
        archive.writestr(f"{name}/byteorder", byteorder)
        archive.writestr(f"{name}/data/0", storage)
        archive.writestr(f"{name}/version", b"3\n")
    return buffer.getvalue()


def at_start(value: Any) -> bytes:
    return voicepack(AT_START, value.astype("<f4").tobytes())


def offset(value: Any, lead: Any) -> bytes:
    """`value` behind one leading row of `lead`, as am_v0gurney.pt's storage is laid out."""
    return voicepack(OFFSET, np.concatenate([lead.reshape(-1), value.reshape(-1)]).astype("<f4").tobytes())


class Detonator:
    """Unpickling this runs a command. A reader that unpickles an upload would run it."""

    def __init__(self, marker: str) -> None:
        self.marker = marker

    def __reduce__(self) -> tuple[Any, ...]:
        return (os.system, (f"touch {self.marker}",))


def malicious(marker: str) -> bytes:
    return voicepack(pickle.dumps(Detonator(marker), protocol=2), b"\x00" * ROWS * 4)
