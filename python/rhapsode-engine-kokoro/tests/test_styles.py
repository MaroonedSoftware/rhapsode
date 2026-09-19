"""Reading, mixing and keeping Kokoro style vectors. protocol.md § 7."""

from __future__ import annotations

import io
from pathlib import Path

import numpy as np
import pytest
from harness import voicepacks
from rhapsode_worker import BadRequest

from rhapsode_engine_kokoro import styles


def npy(value: object) -> bytes:
    buffer = io.BytesIO()
    np.save(buffer, value)
    return buffer.getvalue()


class TestVoicepacks:
    def test_a_pack_whose_tensor_starts_its_storage(self) -> None:
        value = voicepacks.style(1)
        assert np.array_equal(styles.read_style(voicepacks.at_start(value), "pt"), value)

    def test_a_pack_whose_tensor_is_a_view_past_the_start(self) -> None:
        # Kokoro-FastAPI's v0 packs. Read from the start of the storage, every row would be the one
        # before it, and the voice would be spoken with the style of a phoneme count one shorter.
        value, lead = voicepacks.style(1), np.full((1, 1, 256), 9.0, dtype=np.float32)
        assert np.array_equal(styles.read_style(voicepacks.offset(value, lead), "pt"), value)

    def test_nothing_in_it_is_unpickled(self, tmp_path: Path) -> None:
        marker = tmp_path / "ran"
        with pytest.raises(BadRequest, match="not a float32 torch voicepack"):
            styles.read_style(voicepacks.malicious(str(marker)), "pt")
        assert not marker.exists()

    def test_a_storage_shorter_than_its_pickle_says_is_refused(self) -> None:
        pack = voicepacks.voicepack(voicepacks.AT_START, b"\x00" * 16)
        with pytest.raises(BadRequest, match="does not hold the tensor"):
            styles.read_style(pack, "pt")

    def test_a_big_endian_pack_is_refused(self) -> None:
        pack = voicepacks.voicepack(voicepacks.AT_START, b"\x00" * voicepacks.ROWS * 4, byteorder=b"big")
        with pytest.raises(BadRequest, match="big-endian"):
            styles.read_style(pack, "pt")

    def test_something_that_is_not_a_zip_is_refused(self) -> None:
        with pytest.raises(BadRequest, match="not a torch voicepack"):
            styles.read_style(b"RIFF....WAVE", "pt")


class TestNpy:
    def test_the_right_shape_is_read_as_float32(self) -> None:
        value = voicepacks.style(2).astype(np.float64)
        read = styles.read_style(npy(value), "npy")
        assert read.dtype == np.float32 and read.shape == styles.SHAPE

    def test_the_wrong_shape_says_which_it_wanted(self) -> None:
        with pytest.raises(BadRequest, match="510 x 1 x 256, and this is 510 x 256"):
            styles.read_style(npy(np.zeros((510, 256), dtype=np.float32)), "npy")

    def test_an_object_array_is_refused_rather_than_unpickled(self) -> None:
        with pytest.raises(BadRequest, match=r"not a \.npy array"):
            styles.read_style(npy(np.array([object()], dtype=object)), "npy")

    def test_a_non_finite_value_is_refused(self) -> None:
        value = voicepacks.style(3)
        value[0, 0, 0] = np.nan
        with pytest.raises(BadRequest, match="not a finite number"):
            styles.read_style(npy(value), "npy")


def test_a_reference_with_no_type_is_refused() -> None:
    with pytest.raises(BadRequest, match=r"\.npy or \.pt"):
        styles.read_style(b"", "")


def test_a_mix_is_the_weighted_sum() -> None:
    one, two = voicepacks.style(4), voicepacks.style(5)
    assert np.allclose(styles.mix([(one, 0.75), (two, 0.25)]), one * 0.75 + two * 0.25)


def test_a_kept_voice_comes_back_as_it_went_in(tmp_path: Path) -> None:
    value = voicepacks.style(6)
    styles.save(tmp_path / "host.npz", value, {"recipe": "a+b", "lang": "en-gb"})
    style, meta = styles.load(tmp_path / "host.npz")
    assert np.array_equal(style, value) and meta == {"recipe": "a+b", "lang": "en-gb"}
    # Nothing half-written is left beside it, under a name a listing would take for a voice.
    assert [path.name for path in tmp_path.iterdir()] == ["host.npz"]
