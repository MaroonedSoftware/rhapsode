"""Codes to PCM."""

from __future__ import annotations

import struct

import numpy as np
from harness.stubs import Recorder

from rhapsode_engine_orpheus.builds import SNAC_REPOSITORY, SNAC_REVISION
from rhapsode_engine_orpheus.codes import SAMPLES_PER_FRAME, Window
from rhapsode_engine_orpheus.decoder import SnacDecoder, pcm


def test_out_of_range_samples_are_clipped_rather_than_wrapped() -> None:
    # Unclipped, 1.01 * 32767 overflows int16 and wraps to near -32768: a click.
    values = struct.unpack("<4h", pcm(np.array([1.01, -1.01, 0.5, 0.0], dtype=np.float32)))
    assert values == (32767, -32767, 16383, 0)


def test_the_codec_is_pinned_to_a_revision(orpheus: Recorder) -> None:
    SnacDecoder("cpu")
    assert orpheus.downloads == [{"repo_id": SNAC_REPOSITORY, "revision": SNAC_REVISION}]


def test_a_window_decodes_to_exactly_the_samples_it_keeps(orpheus: Recorder) -> None:
    decoder = SnacDecoder("cpu")
    codes = tuple(range(4 * 7))
    assert (
        len(decoder.decode(Window(codes, SAMPLES_PER_FRAME, 2 * SAMPLES_PER_FRAME))) == SAMPLES_PER_FRAME * 2
    )
    assert len(decoder.decode(Window(codes, 2 * SAMPLES_PER_FRAME, None))) == 2 * SAMPLES_PER_FRAME * 2


def test_the_codec_is_given_three_layers(orpheus: Recorder) -> None:
    import snac

    SnacDecoder("cpu").decode(Window(tuple(range(14)), 0, None))
    coarse, middle, fine = snac.codec.decoded[0]  # type: ignore[attr-defined]
    assert (len(coarse), len(middle), len(fine)) == (2, 4, 8)
