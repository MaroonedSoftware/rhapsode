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

from rhapsode_engine_styletts2 import upstream

TOP = f"StyleTTS2-{upstream.COMMIT}"

TREE = {
    "models.py": b"from Utils.ASR.models import ASRCNN\n",
    "text_utils.py": b"symbols = []\n",
    "Modules/diffusion/sampler.py": b"# the sampler\n",
    "Utils/PLBERT/step_1000000.t7": b"\x80\x02weights",
    "LICENSE": b"MIT License\n",
    # Not kept: training, which imports monotonic_align, and the demo notebooks.
    "train_second.py": b"from monotonic_align import maximum_path\n",
    "utils.py": b"from monotonic_align import mask_from_lens\n",
    "Demo/Inference_LibriTTS.ipynb": b"{}\n",
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
        if name.split("/")[0] in ("models.py", "text_utils.py", "Modules", "Utils", "LICENSE"):
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
    assert f"https://codeload.github.com/yl4579/StyleTTS2/tar.gz/{upstream.COMMIT}" == upstream.ARCHIVE
    assert len(upstream.COMMIT) == 40


def test_keeps_what_inference_imports_its_checkpoints_and_licence_and_nothing_else(tmp_path: Path) -> None:
    target = tmp_path / "source"
    upstream.fetch(target, Opener(archive(TREE)), kept_digest(tmp_path))
    kept = sorted(p.relative_to(target).as_posix() for p in target.rglob("*") if p.is_file())
    assert kept == [
        ".rhapsode-tree",
        "LICENSE",
        "Modules/diffusion/sampler.py",
        "Utils/PLBERT/step_1000000.t7",
        "models.py",
        "text_utils.py",
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
    tampered = {**TREE, "Utils/PLBERT/step_1000000.t7": b"\x80\x02not upstream's"}
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
    escape = tarfile.TarInfo(f"{TOP}/Modules/../../escaped.py")
    escape.size = 1
    with pytest.raises(Internal, match="outside itself"):
        upstream.fetch(tmp_path / "source", Opener(archive(TREE, [escape])), kept_digest(tmp_path))
    assert not (tmp_path / "escaped.py").exists()


def test_a_link_is_refused(tmp_path: Path) -> None:
    link = tarfile.TarInfo(f"{TOP}/Modules/passwd")
    link.type = tarfile.SYMTYPE
    link.linkname = "/etc/passwd"
    with pytest.raises(Internal, match="not a file"):
        upstream.fetch(tmp_path / "source", Opener(archive(TREE, [link])), kept_digest(tmp_path))


def test_a_directory_without_the_marker_is_fetched_again(tmp_path: Path) -> None:
    # What an interrupted fetch would leave, if one ever renamed a tree into place unfinished.
    target, digest = tmp_path / "source", kept_digest(tmp_path)
    (target / "Modules").mkdir(parents=True)
    opener = Opener(archive(TREE))
    upstream.ensure(target, opener, digest)
    assert opener.urls and upstream.present(target, digest)


def test_activate_puts_the_tree_first_once(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sys, "path", ["/somewhere/else"])
    upstream.activate(tmp_path)
    upstream.activate(tmp_path)
    assert sys.path == [str(tmp_path), "/somewhere/else"]


def test_the_cache_is_per_commit_unless_configured(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.delenv("RHAPSODE_STYLETTS2_SOURCE", raising=False)
    assert upstream.source_dir().parts[-3:] == ("rhapsode", "styletts2", upstream.COMMIT)
    monkeypatch.setenv("RHAPSODE_STYLETTS2_SOURCE", str(tmp_path))
    assert upstream.source_dir() == tmp_path
