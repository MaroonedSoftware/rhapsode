"""Upstream's inference code, fetched at one commit beside the weights rather than shipped in a package.

StyleTTS 2 has no package to install. The one on PyPI is a third party's from January 2024, which
pins langchain below 0.2 and huggingface-hub below 0.20 and swaps eSpeak's phonemes for gruut's,
which its own README says reads worse. Upstream is a repository of scripts, and inference imports
`models.py`, `text_utils.py`, `Modules/` and `Utils/` from its root. `Utils/` also holds three of
the checkpoints the model is built from: the text aligner, the pitch extractor and PL-BERT, 134 MB
that are in the repository and not on the Hugging Face Hub. So the worker downloads that tree, as it
downloads the weights.

The archive is GitHub's, which does not promise the same bytes twice, so what is pinned is the
unpacked tree: every file kept, by path and content. A recompressed archive of the same commit
passes; a changed file fails. That digest is also what makes the checkpoints safe to load: they
pickle `getattr` and a learning-rate scheduler, which torch since 2.6 refuses to unpickle unless
told the file is trusted, and a file whose every byte is pinned is.
"""

from __future__ import annotations

import hashlib
import io
import os
import shutil
import sys
import tarfile
import tempfile
import urllib.request
from collections.abc import Callable
from pathlib import Path, PurePosixPath
from typing import BinaryIO

from rhapsode_worker import Internal

REPOSITORY = "yl4579/StyleTTS2"
COMMIT = "5cedc71c333f8d8b8551ca59378bdcc7af4c9529"
ARCHIVE = f"https://codeload.github.com/{REPOSITORY}/tar.gz/{COMMIT}"

#: What is kept of the archive: what inference imports, the three checkpoints under `Utils/`, and the
#: licence. Not the training scripts, which import `monotonic_align`, built from source with a compiler.
KEPT = ("models.py", "text_utils.py", "Modules/", "Utils/", "LICENSE")

#: `tree_digest` of what is kept at COMMIT: 26 files and 141 MB, the same from two downloads of the
#: 140 MB archive on 7 October 2026.
TREE_DIGEST = "7f235ba15ccf819be7b8889363d0da87d86322a1bda7cf692a825669f90e619d"

#: Written last, so a directory without it is one an earlier fetch did not finish.
MARKER = ".rhapsode-tree"

Opener = Callable[[str], BinaryIO]


def source_dir() -> Path:
    """`RHAPSODE_STYLETTS2_SOURCE`, else `~/.cache/rhapsode/styletts2/<commit>`.

    Outside the virtualenv, as Kokoro's weights are, so a reinstall keeps it; named for the commit, so
    a new pin is a new directory rather than an overwrite of one a running worker imports from.
    """
    configured = os.getenv("RHAPSODE_STYLETTS2_SOURCE")
    if configured:
        return Path(configured)
    return Path.home() / ".cache" / "rhapsode" / "styletts2" / COMMIT


def present(directory: Path, digest: str = TREE_DIGEST) -> bool:
    """Whether a finished fetch of this tree is here. By the marker, not by hashing on every load."""
    marker = directory / MARKER
    return marker.is_file() and marker.read_text().strip() == digest


def ensure(directory: Path | None = None, opener: Opener | None = None, digest: str = TREE_DIGEST) -> Path:
    """The source directory, downloading and checking it first if it is not already here."""
    directory = directory or source_dir()
    if not present(directory, digest):
        fetch(directory, opener or _open, digest)
    return directory


def fetch(directory: Path, opener: Opener, digest: str = TREE_DIGEST) -> None:
    """Download the archive, unpack what is kept into a temporary directory beside the target, check
    the tree, then rename it into place, so a half-unpacked tree is never `present`."""
    directory.parent.mkdir(parents=True, exist_ok=True)
    with opener(ARCHIVE) as source:
        archive = source.read()
    staging = Path(tempfile.mkdtemp(prefix=f".{directory.name}.", dir=directory.parent))
    try:
        unpack(archive, staging)
        found = tree_digest(staging)
        if found != digest:
            raise Internal(
                f"StyleTTS2 at {COMMIT[:7]} unpacked to a tree with digest {found}; expected {digest}"
            )
        (staging / MARKER).write_text(digest)
        if directory.exists():
            shutil.rmtree(directory)
        os.replace(staging, directory)
    finally:
        if staging.exists():
            shutil.rmtree(staging)


def unpack(archive: bytes, target: Path) -> None:
    """The kept members of a GitHub archive, with its top-level `<repo>-<commit>/` removed.

    Regular files and directories only. A link, or a path that is absolute or climbs out with `..`,
    is refused rather than skipped: none is in upstream's tree, so one in the archive is not upstream's.
    """
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as tar:
        for member in tar.getmembers():
            parts = PurePosixPath(member.name).parts
            if len(parts) < 2:
                continue
            relative = PurePosixPath(*parts[1:])
            if member.name.startswith("/") or ".." in relative.parts:
                raise Internal(f"the StyleTTS2 archive has a path outside itself: {member.name}")
            if not _kept(relative):
                continue
            if member.isdir():
                (target / relative).mkdir(parents=True, exist_ok=True)
                continue
            if not member.isfile():
                raise Internal(f"the StyleTTS2 archive has something that is not a file: {member.name}")
            extracted = tar.extractfile(member)
            assert extracted is not None
            path = target / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(extracted.read())


def tree_digest(root: Path) -> str:
    """SHA-256 over every file under `root` but the marker, in path order: each path, then the
    SHA-256 of its content. Independent of how the archive was compressed or what order it lists."""
    digest = hashlib.sha256()
    for path in sorted(p for p in root.rglob("*") if p.is_file() and p.name != MARKER):
        relative = path.relative_to(root).as_posix()
        digest.update(relative.encode() + b"\0" + hashlib.sha256(path.read_bytes()).digest() + b"\n")
    return digest.hexdigest()


def activate(directory: Path) -> None:
    """Make upstream's top-level `models`, `text_utils`, `Modules` and `Utils` importable from this
    tree. First on the path, because those are names anything else could also have."""
    entry = str(directory)
    if entry not in sys.path:
        sys.path.insert(0, entry)


def _kept(relative: PurePosixPath) -> bool:
    name = relative.as_posix()
    return any(name == kept.rstrip("/") or (kept.endswith("/") and name.startswith(kept)) for kept in KEPT)


def _open(url: str) -> BinaryIO:
    return urllib.request.urlopen(url, timeout=120)  # type: ignore[no-any-return]
