"""Which files arrive, and that nothing arrives half-written or wrong."""

from __future__ import annotations

import hashlib
import io
from pathlib import Path

import pytest
from rhapsode_worker import Internal, Unsupported

from rhapsode_engine_kokoro import weights


@pytest.fixture
def small(monkeypatch: pytest.MonkeyPatch) -> dict[str, bytes]:
    """Every asset replaced by a few bytes, with a size and a hash to match."""
    contents = {
        asset.name: f"bytes of {asset.name}".encode() for asset in [*weights.MODELS.values(), weights.VOICES]
    }

    def asset(real: weights.Asset) -> weights.Asset:
        body = contents[real.name]
        return weights.Asset(real.name, len(body), hashlib.sha256(body).hexdigest())

    monkeypatch.setattr(weights, "MODELS", {name: asset(model) for name, model in weights.MODELS.items()})
    monkeypatch.setattr(weights, "VOICES", asset(weights.VOICES))
    return contents


def serving(contents: dict[str, bytes], fetched: list[str]) -> weights.Opener:
    def opener(url: str) -> io.BytesIO:
        fetched.append(url)
        return io.BytesIO(contents[Path(url).name])

    return opener


def test_downloads_what_a_variant_needs_and_nothing_else(small: dict[str, bytes], tmp_path: Path) -> None:
    fetched: list[str] = []
    model, voices = weights.ensure("fp16", tmp_path, serving(small, fetched))

    assert [Path(url).name for url in fetched] == ["kokoro-v1.0.fp16.onnx", "voices-v1.0.bin"]
    assert fetched[0].startswith(weights.RELEASE)
    assert model.read_bytes() == small["kokoro-v1.0.fp16.onnx"]
    assert voices.name == "voices-v1.0.bin"


def test_does_not_download_what_is_already_there(small: dict[str, bytes], tmp_path: Path) -> None:
    fetched: list[str] = []
    weights.ensure("fp16", tmp_path, serving(small, fetched))
    weights.ensure("int8", tmp_path, serving(small, fetched))

    # The voices file is shared, so the second variant fetches only its own graph.
    assert [Path(url).name for url in fetched][-1] == "kokoro-v1.0.int8.onnx"
    assert len(fetched) == 3


def test_a_download_that_does_not_match_is_refused_and_leaves_nothing(
    small: dict[str, bytes], tmp_path: Path
) -> None:
    # A truncated graph fails at load with a protobuf error nobody would connect to a dropped
    # connection, so a mismatch is caught here, named, and removed.
    corrupt = {**small, "kokoro-v1.0.fp16.onnx": b"truncated"}
    with pytest.raises(Internal, match="expected"):
        weights.ensure("fp16", tmp_path, serving(corrupt, []))

    assert not (tmp_path / "kokoro-v1.0.fp16.onnx").exists()
    assert not (tmp_path / "kokoro-v1.0.fp16.onnx.partial").exists()


def test_a_file_of_the_wrong_size_is_fetched_again(small: dict[str, bytes], tmp_path: Path) -> None:
    (tmp_path / "voices-v1.0.bin").write_bytes(b"left over from an interrupted copy")
    fetched: list[str] = []
    weights.ensure("fp16", tmp_path, serving(small, fetched))
    assert "voices-v1.0.bin" in [Path(url).name for url in fetched]


def test_a_variant_it_does_not_have_is_unsupported(tmp_path: Path) -> None:
    with pytest.raises(Unsupported, match="no variant"):
        weights.ensure("bf16", tmp_path, serving({}, []))


def test_the_weights_live_where_the_operator_says(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("RHAPSODE_KOKORO_WEIGHTS", str(tmp_path))
    assert weights.weights_dir() == tmp_path
