"""What a loaded model costs, measured rather than declared.

Nothing else in this protocol knows this number. `Device.vram_bytes` is the card's capacity, not its
use, so a core deciding what to evict has been working from a count of models and the assumption
that they are all the same size. They are not: Kokoro is 82M parameters and Dia is 1.6B.

The measurement is a delta across the load and it is approximate by construction. It is card-wide
rather than per-tensor because that is the only figure that counts the pieces nobody attributes to
a model: the CUDA context, an ONNX Runtime arena, a vLLM worker in a child process. An adapter that
knows better says so through `Engine.memory_bytes`, which wins.

Card-wide also means it counts what other processes freed during the load. Chatterbox `turbo`
measured 2.6 GiB on its earlier loads, then reported nothing after one onto a full card shared with
Ollama, because the card gave back more than the model took. So the worker's own allocator is read
across the load as well, where it has one, and it is the answer whenever the card-wide delta comes
out smaller than it. protocol.md § 3.

torch is imported inside the functions, as in `detect_device`: an ONNX or pure-CPU adapter has no
torch and must still be able to install this SDK.
"""

from __future__ import annotations

import gc
import os
import subprocess
import sys
from pathlib import Path
from typing import NamedTuple

from .engine import Device

__all__ = ["Snapshot", "cost", "held_bytes", "own_bytes", "release", "snapshot"]


class Snapshot(NamedTuple):
    """What the device and this process's own allocator held at one moment. Either may be None."""

    held: int | None
    own: int | None


def snapshot(device: Device) -> Snapshot:
    return Snapshot(held=held_bytes(device), own=own_bytes(device))


def cost(before: Snapshot, after: Snapshot) -> int | None:
    """What a load cost, from readings taken on either side of it, or None when nothing could say.

    The card-wide delta is preferred, because it counts the context and the allocations torch never
    sees. But it can never honestly be smaller than what this process's own allocator took: when it
    is, another process freed memory during the load, and the allocator's figure is the one left
    standing. A result of zero or less is a failed measurement, never a free model.
    """
    held = _delta(before.held, after.held)
    own = _delta(before.own, after.own)
    if held is not None and (own is None or held >= own):
        best: int | None = held
    else:
        best = own
    return best if best is not None and best > 0 else None


def _delta(before: int | None, after: int | None) -> int | None:
    return None if before is None or after is None else after - before


def release() -> int:
    """Collect what an unload left in reference cycles, then give the device's cache back.

    An adapter's `unload` drops its model and calls `empty_cache` itself, but a model held in a cycle
    is not freed when its last name goes, only when the collector next runs, so that `empty_cache`
    has nothing to return. Measured with Fish Audio S2 Pro on an RTX 4070 Ti SUPER: 3.93 GiB of the
    11.97 a load took was still allocated after its unload, and none after a `gc.collect()`. Every
    reload in a conformance run then ran out of memory on an otherwise empty card. The codec's weight
    norm parametrisations are one source of such cycles, and nothing an adapter does by hand reaches
    them all.

    torch is not imported here: if no adapter imported it, it holds nothing to give back.
    Returns how many objects the collector found, for the log.
    """
    found = gc.collect()
    torch = sys.modules.get("torch")
    if torch is not None:
        try:
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            elif torch.backends.mps.is_available():
                torch.mps.empty_cache()
        except Exception:
            pass
    return found


def held_bytes(device: Device) -> int | None:
    """What is in use on this device now, or None when nothing here can say.

    None rather than 0, because "nothing measured it" and "it cost nothing" are different answers
    and only one of them should ever reach a caller as a number.
    """
    if device.type in {"cuda", "rocm"}:
        return _accelerator_bytes()
    if device.type == "mps":
        return _mps_bytes()
    return _resident_set_bytes()


def own_bytes(device: Device) -> int | None:
    """What this process's own allocator has reserved on the device, where that differs from
    `held_bytes`.

    Only CUDA and ROCm need it: `held_bytes` is already this process alone on MPS and the CPU. On a
    card it is a floor, since it misses the context and anything outside torch, and it is the only
    reading another process cannot move. The driver's per-process list would be better and cannot
    be used: inside a container it names processes by host PID, and a worker cannot tell which of
    them is itself.
    """
    if device.type not in {"cuda", "rocm"}:
        return None
    try:  # pragma: no cover - depends on what the adapter's venv happens to hold
        import torch

        return int(torch.cuda.memory_reserved())
    except Exception:
        return None


def _accelerator_bytes() -> int | None:
    try:  # pragma: no cover - depends on what the adapter's venv happens to hold
        import torch

        free, total = torch.cuda.mem_get_info()
        # Card-wide rather than `memory_allocated`, which sees only torch's own allocator and so
        # reads zero for an ONNX session and misses the context torch itself puts on the card.
        return int(total - free)
    except Exception:
        return None


def _mps_bytes() -> int | None:
    try:  # pragma: no cover - depends on what the adapter's venv happens to hold
        import torch

        return int(torch.mps.driver_allocated_memory())
    except Exception:
        return None


def _resident_set_bytes() -> int | None:
    """This process's resident set. The CPU answer, and the fallback nothing else covers.

    Linux reads it from procfs; everywhere else pays for a subprocess, which is affordable because
    this is called twice per load and never during synthesis.
    """
    statm = Path("/proc/self/statm")
    try:
        if statm.exists():
            pages = int(statm.read_text().split()[1])
            return pages * os.sysconf("SC_PAGE_SIZE")
    except Exception:
        return None

    try:
        argv = ["ps", "-o", "rss=", "-p", str(os.getpid())]
        out = subprocess.run(argv, capture_output=True, text=True, timeout=5, check=False)
        kilobytes = out.stdout.strip()
        return int(kilobytes) * 1024 if kilobytes else None
    except Exception:
        return None
