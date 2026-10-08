"""The SDK's cache of analysed reference clips. protocol.md § 8."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from rhapsode_worker import ReferenceCache


class Analyser:
    """Stands in for a model's analysis, and counts what it was asked to analyse."""

    def __init__(self) -> None:
        self.analysed: list[str] = []

    def __call__(self, path: Path) -> str:
        self.analysed.append(path.stem)
        return f"style:{path.stem}:{path.read_bytes().hex()}"


def clip(directory: Path, name: str, content: bytes = b"RIFF") -> Path:
    path = directory / f"{name}.wav"
    path.write_bytes(content)
    return path


def test_a_clip_is_analysed_once_and_then_reused(tmp_path: Path) -> None:
    cache: ReferenceCache[str] = ReferenceCache(4)
    analyse = Analyser()
    narrator = clip(tmp_path, "narrator")

    first = cache.get(narrator, analyse)
    assert cache.get(narrator, analyse) == first
    assert analyse.analysed == ["narrator"]


def test_a_clip_changed_on_disk_is_analysed_again_and_its_old_entry_goes(tmp_path: Path) -> None:
    cache: ReferenceCache[str] = ReferenceCache(4)
    analyse = Analyser()
    narrator = clip(tmp_path, "narrator")
    cache.get(narrator, analyse)

    narrator.write_bytes(b"RIFF and longer")
    assert cache.get(narrator, analyse) == f"style:narrator:{b'RIFF and longer'.hex()}"
    assert analyse.analysed == ["narrator", "narrator"]
    # The old clip is not on disk any more, so its analysis is only memory held for nothing.
    assert len(cache) == 1


def test_a_change_inside_one_tick_of_the_file_clock_is_caught(tmp_path: Path) -> None:
    # Same size, same mtime: the key cannot tell, so a re-recording says so with `forget`.
    cache: ReferenceCache[str] = ReferenceCache(4)
    analyse = Analyser()
    narrator = clip(tmp_path, "narrator", b"AAAA")
    status = narrator.stat()
    cache.get(narrator, analyse)

    narrator.write_bytes(b"BBBB")
    os.utime(narrator, ns=(status.st_atime_ns, status.st_mtime_ns))
    assert cache.get(narrator, analyse) == f"style:narrator:{b'AAAA'.hex()}"

    cache.forget("narrator")
    assert cache.get(narrator, analyse) == f"style:narrator:{b'BBBB'.hex()}"


def test_the_least_recently_used_is_evicted_first(tmp_path: Path) -> None:
    cache: ReferenceCache[str] = ReferenceCache(2)
    analyse = Analyser()
    clips = {name: clip(tmp_path, name) for name in "abc"}
    for name in "abaca":
        cache.get(clips[name], analyse)
    cache.get(clips["b"], analyse)
    # b was the least recently used when c arrived, so b alone is analysed twice.
    assert analyse.analysed == ["a", "b", "c", "b"]


def test_forget_drops_only_that_voice(tmp_path: Path) -> None:
    cache: ReferenceCache[str] = ReferenceCache(4)
    analyse = Analyser()
    narrator, host = clip(tmp_path, "narrator"), clip(tmp_path, "host")
    cache.get(narrator, analyse)
    cache.get(host, analyse)

    cache.forget("narrator")
    cache.get(narrator, analyse)
    cache.get(host, analyse)
    assert analyse.analysed == ["narrator", "host", "narrator"]


def test_clear_drops_everything(tmp_path: Path) -> None:
    cache: ReferenceCache[str] = ReferenceCache(4)
    analyse = Analyser()
    narrator = clip(tmp_path, "narrator")
    cache.get(narrator, analyse)

    cache.clear()
    assert len(cache) == 0
    cache.get(narrator, analyse)
    assert analyse.analysed == ["narrator", "narrator"]


def test_an_analysis_that_is_none_is_still_kept(tmp_path: Path) -> None:
    # Whatever the adapter's analysis returns is its business, None included.
    cache: ReferenceCache[None] = ReferenceCache(4)
    calls: list[Path] = []
    narrator = clip(tmp_path, "narrator")
    for _ in range(2):
        cache.get(narrator, calls.append)
    assert calls == [narrator]


def test_a_cache_that_keeps_nothing_is_refused() -> None:
    with pytest.raises(ValueError, match="at least one"):
        ReferenceCache(0)
