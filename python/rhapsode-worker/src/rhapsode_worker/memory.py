"""What a loaded model costs, measured rather than declared.

Nothing else in this protocol knows this number. `Device.vram_bytes` is the card's capacity, not its
use, so a core deciding what to evict has been working from a count of models and the assumption
that they are all the same size. They are not: Kokoro is 82M parameters and Dia is 1.6B.

The measurement is a delta across the load and it is approximate by construction. It is card-wide
rather than per-tensor because that is the only figure that counts the pieces nobody attributes to
a model: the CUDA context, an ONNX Runtime arena, a vLLM worker in a child process. An adapter that
knows better says so through `Engine.memory_bytes`, which wins.

torch is imported inside the functions, as in `detect_device`: an ONNX or pure-CPU adapter has no
torch and must still be able to install this SDK.
"""

from __future__ import annotations

import gc
import os
import subprocess
import sys
from pathlib import Path

from .engine import Device

__all__ = ["held_bytes", "release"]


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
