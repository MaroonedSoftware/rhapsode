"""Upstream's code, fetched at one commit and checked by what it unpacks to."""

from __future__ import annotations

import io
import sys
import tarfile
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import pytest
from rhapsode_worker import Internal

from rhapsode_engine_fish import upstream

TOP = f"fish-speech-{upstream.COMMIT}"

TREE = {
    "fish_speech/__init__.py": b"",
    "fish_speech/models/dac/inference.py": b"# the codec\n",
    "fish_speech/configs/modded_dac_vq.yaml": b"_target_: x\n",
    "LICENSE": b"FISH AUDIO RESEARCH LICENSE AGREEMENT\n",
    ".project-root": b"",
    # Not kept: upstream's servers, web UI and docs.
    "tools/api_server.py": b"import kui\n",
    "awesome_webui/package.json": b"{}\n",
    "pyproject.toml": b'dependencies = ["pyaudio"]\n',
}


def archive(files: dict[str, bytes], extra: list[tarfile.TarInfo] | None = None) -> bytes:
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as tar:
        top = tarfile.TarInfo(TOP)
        top.type = tarfile.DIRTYPE
        tar.addfile(top)
        for name, content in files.items():
            info = tarfile.TarInfo(f"{TOP}/{name}")
            info.size = len(content)
            tar.addfile(info, io.BytesIO(content))
        for info in extra or []:
            tar.addfile(info, io.BytesIO(b"x" * info.size) if info.isfile() else None)
    return buffer.getvalue()


def kept_digest(tmp_path: Path) -> str:
    """The digest of TREE's kept files, computed the way the module computes it."""
    root = tmp_path / "expected"
    for name, content in TREE.items():
        if name.startswith(("fish_speech/", "LICENSE", ".project-root")):
            (root / name).parent.mkdir(parents=True, exist_ok=True)
            (root / name).write_bytes(content)
    return upstream.tree_digest(root)


class Opener:
    def __init__(self, payload: bytes) -> None:
        self.payload = payload
        self.urls: list[str] = []

    @contextmanager
    def __call__(self, url: str) -> Iterator[io.BytesIO]:
        self.urls.append(url)
        yield io.BytesIO(self.payload)


def test_the_archive_is_upstreams_at_the_pinned_commit() -> None:
    assert f"https://codeload.github.com/fishaudio/fish-speech/tar.gz/{upstream.COMMIT}" == upstream.ARCHIVE
    assert len(upstream.COMMIT) == 40


def test_keeps_the_package_its_licence_and_the_marker_and_nothing_else(tmp_path: Path) -> None:
    target = tmp_path / "source"
    upstream.fetch(target, Opener(archive(TREE)), kept_digest(tmp_path))
    kept = sorted(p.relative_to(target).as_posix() for p in target.rglob("*") if p.is_file())
    assert kept == [
        ".project-root",
        ".rhapsode-tree",
        "LICENSE",
        "fish_speech/__init__.py",
        "fish_speech/configs/modded_dac_vq.yaml",
        "fish_speech/models/dac/inference.py",
    ]


def test_a_finished_fetch_is_present_and_not_fetched_again(tmp_path: Path) -> None:
    target, digest = tmp_path / "source", kept_digest(tmp_path)
    opener = Opener(archive(TREE))
    upstream.ensure(target, opener, digest)
    upstream.ensure(target, opener, digest)
    assert len(opener.urls) == 1
    assert upstream.present(target, digest)


def test_a_changed_file_is_refused_and_leaves_nothing_behind(tmp_path: Path) -> None:
    target = tmp_path / "source"
    tampered = {**TREE, "fish_speech/models/dac/inference.py": b"# not upstream's\n"}
    with pytest.raises(Internal, match="digest"):
        upstream.fetch(target, Opener(archive(tampered)), kept_digest(tmp_path))
    assert not target.exists()
    assert list(tmp_path.iterdir()) == [tmp_path / "expected"]


def test_a_recompressed_archive_of_the_same_tree_passes(tmp_path: Path) -> None:
    # GitHub does not promise the same archive bytes twice; the tree is what is pinned.
    reordered = dict(reversed(list(TREE.items())))
    assert archive(reordered) != archive(TREE)
    upstream.fetch(tmp_path / "source", Opener(archive(reordered)), kept_digest(tmp_path))


def test_a_path_that_climbs_out_is_refused(tmp_path: Path) -> None:
    escape = tarfile.TarInfo(f"{TOP}/fish_speech/../../escaped.py")
    escape.size = 1
    with pytest.raises(Internal, match="outside itself"):
        upstream.fetch(tmp_path / "source", Opener(archive(TREE, [escape])), kept_digest(tmp_path))
    assert not (tmp_path / "escaped.py").exists()


def test_a_link_is_refused(tmp_path: Path) -> None:
    link = tarfile.TarInfo(f"{TOP}/fish_speech/passwd")
    link.type = tarfile.SYMTYPE
    link.linkname = "/etc/passwd"
    with pytest.raises(Internal, match="not a file"):
        upstream.fetch(tmp_path / "source", Opener(archive(TREE, [link])), kept_digest(tmp_path))


def test_a_directory_without_the_marker_is_fetched_again(tmp_path: Path) -> None:
    # What an interrupted fetch would leave, if one ever renamed a tree into place unfinished.
    target, digest = tmp_path / "source", kept_digest(tmp_path)
    (target / "fish_speech").mkdir(parents=True)
    opener = Opener(archive(TREE))
    upstream.ensure(target, opener, digest)
    assert opener.urls and upstream.present(target, digest)


def test_activate_puts_the_tree_first_once(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sys, "path", ["/somewhere/else"])
    upstream.activate(tmp_path)
    upstream.activate(tmp_path)
    assert sys.path == [str(tmp_path), "/somewhere/else"]


def test_the_cache_is_per_commit_unless_configured(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.delenv("RHAPSODE_FISH_SOURCE", raising=False)
    assert upstream.source_dir().parts[-3:] == ("rhapsode", "fish-speech", upstream.COMMIT)
    monkeypatch.setenv("RHAPSODE_FISH_SOURCE", str(tmp_path))
    assert upstream.source_dir() == tmp_path
