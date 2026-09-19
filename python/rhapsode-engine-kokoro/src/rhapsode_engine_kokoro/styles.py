"""Kokoro style vectors: reading an uploaded one, mixing several, and keeping one. protocol.md § 7.

A Kokoro voice IS a style vector, 510 x 1 x 256 float32: one 256-wide style per phoneme count up to
510, which kokoro-onnx indexes by the length of what it is about to say. So a voice from outside the
engine's own set is an array of that shape, and a blend is a weighted sum of them. Nothing here
touches the model, which is why a create takes no residency slot.
"""

from __future__ import annotations

import io
import json
import os
import pickletools
import zipfile
from pathlib import Path
from typing import Any

import numpy as np
from rhapsode_worker import BadRequest

SHAPE = (510, 1, 256)

#: Row-major and packed, which is what `torch.save` writes for a tensor nobody sliced.
CONTIGUOUS_STRIDE = (256, 256, 1)

SUFFIX = ".npz"

#: Every global a voicepack's pickle may name. Anything else is refused before a byte of the tensor is
#: read, because a pickle that names another global is not a voicepack whatever else it is.
VOICEPACK_GLOBALS = frozenset(
    {"torch._utils _rebuild_tensor_v2", "torch FloatStorage", "collections OrderedDict"}
)

#: Opcodes that push an integer, which is how a voicepack's pickle spells sizes, offsets and strides.
INT_OPCODES = frozenset({"INT", "BININT", "BININT1", "BININT2", "LONG", "LONG1", "LONG4"})
STRING_OPCODES = frozenset({"BINUNICODE", "SHORT_BINUNICODE", "UNICODE", "BINUNICODE8"})


def read_style(data: bytes, suffix: str) -> Any:
    """An uploaded style vector as a (510, 1, 256) float32 array, or `bad_request` saying why not."""
    if suffix == "npy":
        style = _read_npy(data)
    elif suffix == "pt":
        style = _read_voicepack(data)
    else:
        # The SDK has already refused a type this engine did not declare. This is the file with no
        # name at all, whose type nothing can tell.
        raise BadRequest("name the reference file .npy or .pt, so its type is known")

    if not np.all(np.isfinite(style)):
        raise BadRequest("the style vector holds a value that is not a finite number")
    return style


def _read_npy(data: bytes) -> Any:
    try:
        # allow_pickle=False: an object array in a .npy is a pickle, and this is an upload.
        array = np.load(io.BytesIO(data), allow_pickle=False)
    except ValueError as error:
        raise BadRequest(f"not a .npy array of numbers: {error}") from None
    if not isinstance(array, np.ndarray) or array.shape != SHAPE:
        shape = getattr(array, "shape", None)
        raise BadRequest(f"a Kokoro style vector is {_shape(SHAPE)}, and this is {_shape(shape)}")
    if not np.issubdtype(array.dtype, np.floating):
        raise BadRequest(f"a Kokoro style vector holds floats, and this holds {array.dtype}")
    return array.astype(np.float32)


def _read_voicepack(data: bytes) -> Any:
    """A `torch.save` of one float tensor, read as data and never unpickled.

    A `.pt` file is a zip holding a pickle and the tensor's raw bytes beside it. Unpickling runs any
    callable the file names, so the pickle is walked opcode by opcode, which executes nothing, and
    only the storage's size, the view's offset, shape and stride are taken from it.

    The view matters. Kokoro-FastAPI's `v0` packs are a 510-row view starting 256 floats into a
    511-row storage (measured: am_v0gurney.pt's storage is 523,264 bytes where 510 rows are
    522,240), so reading the storage from its start shifts every row by one phoneme count.
    """
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
        pickles = [name for name in archive.namelist() if name.endswith("/data.pkl")]
        if len(pickles) != 1:
            raise BadRequest("not a torch voicepack: it has no single data.pkl")
        prefix = pickles[0][: -len("data.pkl")]
        key, numel, offset, shape, stride = _tensor_layout(archive.read(pickles[0]))

        if f"{prefix}byteorder" in archive.namelist():
            order = archive.read(f"{prefix}byteorder").decode().strip()
            if order != "little":
                raise BadRequest(f"the voicepack is {order}-endian, and only little-endian is read")
        storage = archive.read(f"{prefix}data/{key}")
    except (zipfile.BadZipFile, KeyError) as error:
        raise BadRequest(f"not a torch voicepack: {error}") from None

    if shape != SHAPE:
        raise BadRequest(f"a Kokoro style vector is {_shape(SHAPE)}, and this is {_shape(shape)}")
    if stride != CONTIGUOUS_STRIDE:
        raise BadRequest(f"the voicepack's tensor is not packed (stride {stride}), so it is not read")
    count = int(np.prod(SHAPE))
    if len(storage) != numel * 4 or offset < 0 or offset + count > numel:
        raise BadRequest("the voicepack's storage does not hold the tensor its pickle describes")

    values = np.frombuffer(storage, dtype="<f4", count=count, offset=offset * 4)
    return values.reshape(SHAPE).astype(np.float32)


def _tensor_layout(pickled: bytes) -> tuple[str, int, int, tuple[int, ...], tuple[int, ...]]:
    """(storage key, storage length, offset, shape, stride), from the opcodes alone.

    The pickle `torch.save` writes for one float tensor names two globals and then pushes, in order:
    the storage key and device as strings, the storage length, the offset, the shape and the stride.
    Anything else in the stream is refused rather than guessed at.
    """
    globals_named: list[str] = []
    strings: list[str] = []
    integers: list[int] = []
    try:
        for opcode, argument, _ in pickletools.genops(pickled):
            if opcode.name in ("GLOBAL", "STACK_GLOBAL", "INST", "OBJ", "EXT1", "EXT2", "EXT4"):
                if opcode.name != "GLOBAL":
                    raise BadRequest(f"not a torch voicepack: its pickle uses {opcode.name}")
                globals_named.append(str(argument))
            elif opcode.name in STRING_OPCODES:
                strings.append(str(argument))
            elif opcode.name in INT_OPCODES:
                integers.append(int(argument))  # type: ignore[arg-type]
    except ValueError as error:
        raise BadRequest(f"not a torch voicepack: its pickle does not parse: {error}") from None

    unexpected = [name for name in globals_named if name not in VOICEPACK_GLOBALS]
    if unexpected or globals_named[:2] != ["torch._utils _rebuild_tensor_v2", "torch FloatStorage"]:
        raise BadRequest(f"not a float32 torch voicepack: its pickle names {globals_named}")
    if strings[:1] != ["storage"] or len(strings) != 3 or len(integers) != 8:
        raise BadRequest("not a torch voicepack of one three-dimensional tensor")

    numel, offset = integers[0], integers[1]
    return strings[1], numel, offset, tuple(integers[2:5]), tuple(integers[5:8])


def mix(parts: list[tuple[Any, float]]) -> Any:
    """The weighted sum, with shares that already sum to 1. Kokoro-FastAPI's own blend is this sum."""
    return sum((style * share for style, share in parts), np.zeros(SHAPE, dtype=np.float32)).astype(
        np.float32
    )


def save(path: Path, style: Any, meta: dict[str, str]) -> None:
    """Written beside the target and renamed, so a voice is never listed half-written."""
    partial = path.with_name(f".{path.name}.partial")
    with partial.open("wb") as target:
        np.savez(target, style=style, meta=np.array(json.dumps(meta)))
    os.replace(partial, path)


def load(path: Path) -> tuple[Any, dict[str, str]]:
    with np.load(path, allow_pickle=False) as stored:
        return stored["style"], json.loads(str(stored["meta"]))


def _shape(shape: object) -> str:
    return " x ".join(str(size) for size in shape) if isinstance(shape, tuple) else str(shape)
