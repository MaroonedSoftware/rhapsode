"""From the model's tokens to SNAC codes, and which samples of each decode to keep.

Orpheus writes audio as a stream of tokens, seven to a frame. Each token is one SNAC code, offset by
where in its frame it sits, and the seven codes of a frame are spread over SNAC's three layers: one
coarse, two middle, four fine. A frame decodes to 2048 samples at 24 kHz, 85 ms.

Pure, so the framing is testable without the codec or the model. Follows upstream's `decoder.py`
(canopyai/Orpheus-TTS) except where noted, and each difference is a bug there.
"""

from __future__ import annotations

from dataclasses import dataclass

#: `<custom_token_10>`, the first audio token: the vocabulary's 128256 plus upstream's offset of 10.
AUDIO_TOKEN_BASE = 128266

#: Codes per layer in SNAC 24 kHz.
CODEBOOK_SIZE = 4096

FRAME_TOKENS = 7
SAMPLES_PER_FRAME = 2048

#: Upstream decodes the last four frames each time a frame completes and keeps only the second of
#: them. A frame decoded with neighbours on both sides has no edge artefacts, so every frame but the
#: first and the last two is taken from a window where it has context.
WINDOW_FRAMES = 4


def code_of(token_id: int, position: int) -> int | None:
    """The SNAC code a token carries at this position in the stream, or None if it carries none.

    Upstream keeps a code only when it is above zero, which drops a valid code of 0 and shifts every
    later frame by one position, so the rest of the utterance decodes as noise. Its range check also
    lets 4096 through, which is one past the codebook.
    """
    code = token_id - AUDIO_TOKEN_BASE - (position % FRAME_TOKENS) * CODEBOOK_SIZE
    return code if 0 <= code < CODEBOOK_SIZE else None


def layers(codes: tuple[int, ...]) -> tuple[list[int], list[int], list[int]]:
    """Whole frames of codes, spread over SNAC's three layers the way the finetune wrote them."""
    coarse: list[int] = []
    middle: list[int] = []
    fine: list[int] = []
    for start in range(0, len(codes) - len(codes) % FRAME_TOKENS, FRAME_TOKENS):
        frame = codes[start : start + FRAME_TOKENS]
        coarse.append(frame[0])
        middle.extend((frame[1], frame[4]))
        fine.extend((frame[2], frame[3], frame[5], frame[6]))
    return coarse, middle, fine


@dataclass(frozen=True)
class Window:
    """Codes to decode, and which of the samples they decode to are new."""

    codes: tuple[int, ...]
    start: int
    end: int | None


class Framer:
    """Turns a stream of tokens into windows to decode, so that every frame is heard exactly once.

    Upstream's framing has two further losses, both here fixed. It never emits the first frame, nor
    the last two, because nothing after them completes a later window: 255 ms of every generation.
    And an utterance under four frames makes no audio at all, which the core then refuses as a body
    too small to be audio.
    """

    def __init__(self) -> None:
        self._codes: list[int] = []

    def push(self, token_id: int) -> Window | None:
        """One token from the model. A window when it completes a frame that can now be decoded."""
        code = code_of(token_id, len(self._codes))
        if code is None:
            return None
        self._codes.append(code)

        if len(self._codes) % FRAME_TOKENS:
            return None
        frames = len(self._codes) // FRAME_TOKENS
        if frames < WINDOW_FRAMES:
            return None

        window = tuple(self._codes[-WINDOW_FRAMES * FRAME_TOKENS :])
        if frames == WINDOW_FRAMES:
            # The first window also carries the first frame, which no later window will.
            return Window(window, 0, 2 * SAMPLES_PER_FRAME)
        return Window(window, SAMPLES_PER_FRAME, 2 * SAMPLES_PER_FRAME)

    def finish(self) -> Window | None:
        """Whatever has not been heard yet, once the model has stopped. A partial frame is dropped."""
        frames = len(self._codes) // FRAME_TOKENS
        if frames == 0:
            return None
        if frames < WINDOW_FRAMES:
            return Window(tuple(self._codes[: frames * FRAME_TOKENS]), 0, None)
        whole = self._codes[: frames * FRAME_TOKENS]
        return Window(tuple(whole[-WINDOW_FRAMES * FRAME_TOKENS :]), 2 * SAMPLES_PER_FRAME, None)
