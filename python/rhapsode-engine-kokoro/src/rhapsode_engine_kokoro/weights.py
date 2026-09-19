"""Kokoro's weights: which files each variant needs, where they live, and how they arrive.

The files are kokoro-onnx's v1.0 release assets on GitHub, not a Hugging Face repository, so there is
no shared cache to reuse and no revision to pin. What pins them instead is a size and a SHA-256 per
file, taken from the files these were measured with. A download that does not match is refused and
removed, because a truncated ONNX graph fails at load with an error about protobuf that nobody would
connect to a dropped connection.
"""

from __future__ import annotations

import hashlib
import os
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO

from rhapsode_worker import Internal, Unsupported

RELEASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"


@dataclass(frozen=True)
class Asset:
    name: str
    size: int
    sha256: str


#: One graph per variant. The same model at three precisions, measured on an Apple Silicon CPU for a
#: 6.2 s line: fp16 loaded in 0.31 s and ran 9.9x realtime, fp32 0.48 s and 8.3x, and int8, the
#: smallest, 0.25 s and only 2.5x. Smaller is not faster on every CPU, which is why all three exist.
MODELS: dict[str, Asset] = {
    "fp16": Asset(
        "kokoro-v1.0.fp16.onnx",
        177_464_787,
        "c1610a859f3bdea01107e73e50100685af38fff88f5cd8e5c56df109ec880204",
    ),
    "fp32": Asset(
        "kokoro-v1.0.onnx", 325_532_387, "7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5"
    ),
    "int8": Asset(
        "kokoro-v1.0.int8.onnx",
        92_361_271,
        "6e742170d309016e5891a994e1ce1559c702a2ccd0075e67ef7157974f6406cb",
    ),
}

#: Every voice's style vectors, shared by all three graphs.
VOICES = Asset(
    "voices-v1.0.bin", 28_214_398, "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d"
)

#: 1 MiB. Hashed as it arrives, so a 325 MB file is read once, not twice.
BLOCK = 1 << 20

Opener = Callable[[str], BinaryIO]


def weights_dir() -> Path:
    """`RHAPSODE_KOKORO_WEIGHTS`, else `~/.cache/rhapsode/kokoro`.

    Outside the virtualenv, so an uninstall and reinstall keeps them, as uninstalling leaves every
    engine's weights where they are (§ 10).
    """
    configured = os.getenv("RHAPSODE_KOKORO_WEIGHTS")
    return Path(configured) if configured else Path.home() / ".cache" / "rhapsode" / "kokoro"


def assets_for(variant: str) -> tuple[Asset, Asset]:
    model = MODELS.get(variant)
    if model is None:
        raise Unsupported(f'no variant "{variant}"; this engine has {sorted(MODELS)}')
    return model, VOICES


def present(root: Path, asset: Asset) -> bool:
    """By size only, on every load. Hashing 325 MB each time costs a second, and `ensure` hashed it once."""
    path = root / asset.name
    return path.is_file() and path.stat().st_size == asset.size


def ensure(variant: str, root: Path | None = None, opener: Opener | None = None) -> tuple[Path, Path]:
    """The model and voices paths for a variant, downloading whichever is missing."""
    model, voices = assets_for(variant)
    return _ensure(model, root, opener), _ensure(voices, root, opener)


def ensure_voices(root: Path | None = None, opener: Opener | None = None) -> Path:
    """The voices file alone, for a blend: 28 MB, where the smallest graph beside it is 92 MB."""
    return _ensure(VOICES, root, opener)


def _ensure(asset: Asset, root: Path | None, opener: Opener | None) -> Path:
    root = root or weights_dir()
    root.mkdir(parents=True, exist_ok=True)
    if not present(root, asset):
        download(asset, root, opener or _open)
    return root / asset.name


def download(asset: Asset, root: Path, opener: Opener) -> None:
    """Into a temporary name beside the target, verified, then renamed, so a half-file is never `present`."""
    partial = root / f"{asset.name}.partial"
    digest = hashlib.sha256()
    try:
        with opener(f"{RELEASE}/{asset.name}") as source, partial.open("wb") as target:
            while block := source.read(BLOCK):
                digest.update(block)
                target.write(block)
        size = partial.stat().st_size
        if size != asset.size or digest.hexdigest() != asset.sha256:
            raise Internal(
                f"{asset.name} arrived as {size} bytes with SHA-256 {digest.hexdigest()}; "
                f"expected {asset.size} bytes and {asset.sha256}"
            )
        os.replace(partial, root / asset.name)
    finally:
        partial.unlink(missing_ok=True)


def _open(url: str) -> BinaryIO:
    return urllib.request.urlopen(url, timeout=60)  # type: ignore[no-any-return]
