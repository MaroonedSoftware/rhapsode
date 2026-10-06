"""Upstream's inference code, fetched at one commit beside the weights rather than shipped in a package.

`fish-speech` cannot be installed as a package here, for two reasons. Its pyproject depends on
`pyaudio`, which builds against PortAudio's headers with a compiler, and the server image has
neither; nothing on the inference path imports it, nor gradio, wandb, datasets or modelscope, which
come with it. And its code is under the Fish Audio Research License, as the weights are: whoever
distributes it must ship the agreement and display "Built with Fish Audio", and distributing it as
part of a product is a commercial use that needs Fish Audio's own licence. So rhapsode ships none of
it. The operator's box downloads it from upstream, as it downloads the weights, after an install that
accepted that licence by name (protocol.md § 10).

The archive is GitHub's, which does not promise the same bytes twice, so what is pinned is the
unpacked tree: every file kept, by path and content. A recompressed archive of the same commit
passes; a changed file fails.
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

REPOSITORY = "fishaudio/fish-speech"
COMMIT = "214da3cd841bda85da2496b96cd3c4d7edb1337e"
ARCHIVE = f"https://codeload.github.com/{REPOSITORY}/tar.gz/{COMMIT}"

#: What is kept of the archive: the package, its licence, and the empty marker its codec module looks
#: for on import (`pyrootutils.setup_root(indicator=".project-root")`), without which importing
#: `fish_speech.models.dac.inference` raises "Project root directory not found".
KEPT = ("fish_speech/", "LICENSE", ".project-root")

#: `tree_digest` of what is kept at COMMIT: 58 files, the same from two downloads on 6 October 2026.
TREE_DIGEST = "fab0e94c98956278c9931c2fadd03000af79995a334d5432d603d1008afdf5d0"

#: Written last, so a directory without it is one an earlier fetch did not finish.
MARKER = ".rhapsode-tree"

Opener = Callable[[str], BinaryIO]


def source_dir() -> Path:
    """`RHAPSODE_FISH_SOURCE`, else `~/.cache/rhapsode/fish-speech/<commit>`.

    Outside the virtualenv, as Kokoro's weights are, so a reinstall keeps it; named for the commit, so
    a new pin is a new directory rather than an overwrite of one a running worker imports from.
    """
    configured = os.getenv("RHAPSODE_FISH_SOURCE")
    if configured:
        return Path(configured)
    return Path.home() / ".cache" / "rhapsode" / "fish-speech" / COMMIT


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
                f"fish-speech at {COMMIT[:7]} unpacked to a tree with digest {found}; expected {digest}"
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
                raise Internal(f"the fish-speech archive has a path outside itself: {member.name}")
            if not _kept(relative):
                continue
            if member.isdir():
                (target / relative).mkdir(parents=True, exist_ok=True)
                continue
            if not member.isfile():
                raise Internal(f"the fish-speech archive has something that is not a file: {member.name}")
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
    """Make `import fish_speech` find this tree. First on the path, so a stray install of another
    fish-speech in the same virtualenv cannot shadow the pinned one."""
    entry = str(directory)
    if entry not in sys.path:
        sys.path.insert(0, entry)


def _kept(relative: PurePosixPath) -> bool:
    name = relative.as_posix()
    return any(name == kept.rstrip("/") or (kept.endswith("/") and name.startswith(kept)) for kept in KEPT)


def _open(url: str) -> BinaryIO:
    return urllib.request.urlopen(url, timeout=120)  # type: ignore[no-any-return]
