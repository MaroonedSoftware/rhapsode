"""The framing: which token is which code, and that every frame is heard exactly once."""

from __future__ import annotations

import pytest

from rhapsode_engine_orpheus.codes import (
    AUDIO_TOKEN_BASE,
    CODEBOOK_SIZE,
    FRAME_TOKENS,
    SAMPLES_PER_FRAME,
    Framer,
    Window,
    code_of,
    layers,
)


def token(code: int, position: int) -> int:
    """The token the model writes for `code` at `position`, the inverse of `code_of`."""
    return AUDIO_TOKEN_BASE + (position % FRAME_TOKENS) * CODEBOOK_SIZE + code


def frames_heard(windows: list[Window]) -> list[int]:
    """Which frames each window's kept samples belong to, when each frame's coarse code is its index."""
    heard: list[int] = []
    for window in windows:
        coarse = list(window.codes[::FRAME_TOKENS])
        end = None if window.end is None else window.end // SAMPLES_PER_FRAME
        heard.extend(coarse[window.start // SAMPLES_PER_FRAME : end])
    return heard


def utterance(frame_count: int) -> list[Window]:
    framer = Framer()
    windows: list[Window] = []
    position = 0
    for frame in range(frame_count):
        for slot in range(FRAME_TOKENS):
            window = framer.push(token(frame if slot == 0 else slot, position))
            position += 1
            if window is not None:
                windows.append(window)
    tail = framer.finish()
    return windows + ([] if tail is None else [tail])


class TestCodes:
    def test_each_position_in_a_frame_has_its_own_offset(self) -> None:
        for position in range(14):
            assert code_of(token(123, position), position) == 123

    def test_a_code_of_zero_is_a_code(self) -> None:
        # Upstream keeps codes above zero only, which drops this one and shifts every later frame.
        assert code_of(token(0, 3), 3) == 0

    def test_the_codebook_ends_at_4095(self) -> None:
        assert code_of(token(CODEBOOK_SIZE - 1, 0), 0) == CODEBOOK_SIZE - 1
        assert code_of(AUDIO_TOKEN_BASE + CODEBOOK_SIZE, 0) is None

    def test_text_and_special_tokens_carry_no_code(self) -> None:
        for special in (128009, 128257, 128258, 128263, 1000):
            assert code_of(special, 0) is None

    def test_a_frame_spreads_one_two_four_over_the_layers(self) -> None:
        coarse, middle, fine = layers((0, 1, 2, 3, 4, 5, 6, 10, 11, 12, 13, 14, 15, 16))
        assert coarse == [0, 10]
        assert middle == [1, 4, 11, 14]
        assert fine == [2, 3, 5, 6, 12, 13, 15, 16]

    def test_a_partial_frame_is_not_spread(self) -> None:
        assert layers((0, 1, 2, 3, 4, 5, 6, 7, 8)) == ([0], [1, 4], [2, 3, 5, 6])


class TestFramer:
    @pytest.mark.parametrize("frame_count", range(1, 13))
    def test_every_frame_is_heard_exactly_once(self, frame_count: int) -> None:
        # Upstream never emits the first frame or the last two, and under four frames emits nothing.
        assert frames_heard(utterance(frame_count)) == list(range(frame_count))

    def test_a_window_is_four_frames(self) -> None:
        windows = utterance(6)
        assert all(len(window.codes) == 4 * FRAME_TOKENS for window in windows)

    def test_the_middle_is_taken_where_it_has_context_on_both_sides(self) -> None:
        middle = utterance(8)[1:-1]
        assert middle
        kept = {(window.start, window.end) for window in middle}
        assert kept == {(SAMPLES_PER_FRAME, 2 * SAMPLES_PER_FRAME)}

    def test_a_token_carrying_no_code_does_not_move_the_frame(self) -> None:
        framer = Framer()
        framer.push(128257)
        for position in range(4 * FRAME_TOKENS - 1):
            assert framer.push(token(1, position)) is None
        assert framer.push(token(1, 4 * FRAME_TOKENS - 1)) is not None

    def test_a_partial_frame_at_the_end_is_dropped(self) -> None:
        framer = Framer()
        for position in range(FRAME_TOKENS + 3):
            framer.push(token(1, position))
        tail = framer.finish()
        assert tail is not None
        assert len(tail.codes) == FRAME_TOKENS

    def test_nothing_at_all_is_no_window(self) -> None:
        assert Framer().finish() is None
