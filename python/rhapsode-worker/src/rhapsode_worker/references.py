"""What a cloned voice's reference clip becomes once the model has analysed it. protocol.md § 8.

Every cloning engine turns the clip into something before it speaks: conditionals, a style vector,
prompt tokens. Upstream code usually does it inside `generate` whenever it is handed a path, which
is on every request, and the cost is not small. Chatterbox turbo on MPS spent 4.9 s on a cloned line
against 2.2 s for the stock voice until it kept the analysis. So the SDK keeps it, once, here,
rather than each adapter writing the same twenty lines.
"""

from __future__ import annotations

from collections import OrderedDict
from collections.abc import Callable
from pathlib import Path
from typing import Generic, TypeVar

T = TypeVar("T")

#: A clip as it is on disk: its path, its modification time and its size. A re-recorded voice under
#: the same id is a different key, so it is analysed again without anybody having to say so.
Key = tuple[str, int, int]


class ReferenceCache(Generic[T]):
    """The analysed references of the most recently used voices, oldest evicted first.

    An entry is whatever the adapter's `make` returned, which is usually tensors on the device of
    the model that made it. So an adapter clears the cache whenever it loads or unloads a model:
    handing one build's entry to the next is at best the wrong voice and at worst a device mismatch.
    """

    def __init__(self, kept: int) -> None:
        if kept < 1:
            raise ValueError(f"a reference cache must keep at least one entry, not {kept}")
        self._kept = kept
        self._entries: OrderedDict[Key, T] = OrderedDict()

    def get(self, path: Path, make: Callable[[Path], T]) -> T:
        """The analysis of the clip at `path`, from the cache or made now by `make`.

        A hit becomes the most recently used. A miss first drops whatever the same path was cached
        as before, since that is a clip which is no longer on disk.
        """
        status = path.stat()
        key = (str(path), status.st_mtime_ns, status.st_size)

        if key in self._entries:
            self._entries.move_to_end(key)
            return self._entries[key]

        for stale in [stale for stale in self._entries if stale[0] == key[0]]:
            del self._entries[stale]
        made = make(path)
        self._entries[key] = made
        while len(self._entries) > self._kept:
            self._entries.popitem(last=False)
        return made

    def forget(self, voice_id: str) -> None:
        """Drop a voice's entries, by the stem its clip is stored under.

        The key would miss anyway once the file changes. This is for a re-recording that lands with
        the same size inside one tick of the file clock, and for a deleted voice, whose entry would
        otherwise hold device memory until it aged out.
        """
        for key in [key for key in self._entries if Path(key[0]).stem == voice_id]:
            del self._entries[key]

    def clear(self) -> None:
        """Drop everything, as a load or an unload must."""
        self._entries.clear()

    def __len__(self) -> int:
        return len(self._entries)
