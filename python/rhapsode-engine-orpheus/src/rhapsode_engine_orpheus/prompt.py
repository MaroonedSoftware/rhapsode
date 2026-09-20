"""What the model is given: its cue tags, its special tokens, and text in pieces it can finish.

Pure, so every decision about text is testable without a model.
"""

from __future__ import annotations

import re

from rhapsode_worker import segments as text_segments

from .builds import CUE_TAGS

#: The special tokens around a prompt, from upstream's `_format_prompt`: start of human, then the
#: text, then end of text, end of human, start of AI and start of speech. The model answers in audio
#: codes and stops with `END_OF_SPEECH`.
START_OF_HUMAN = 128259
END_OF_PROMPT: tuple[int, ...] = (128009, 128260, 128261, 128257)

#: End of speech. Upstream's package stops on 49158 instead, which in this vocabulary is an ordinary
#: text token and not a stop at all; generation there ends only when `max_tokens` runs out, and the
#: audio after the last word is whatever the model made of the silence.
END_OF_SPEECH = 128258

#: Upstream's `max_tokens`. At seven tokens a frame and 2048 samples a frame at 24 kHz, that is 171
#: frames, or 14.6 s of audio, which is the most one generation can say.
MAX_TOKENS = 1200

#: How much text one generation is given. English is read at roughly 15 characters a second, which
#: puts 180 characters at about 12 s, under the 14.6 s a generation can hold with room for a laugh.
#: The rate is a rule of thumb rather than a measurement of this model; a segment that runs out of
#: tokens is cut off mid-word, so this errs short.
SEGMENT_CHARACTERS = 180

#: Anything already written in the model's own tag syntax. Removed before translation, so the only way
#: to make this engine laugh is the standard vocabulary: a client that learned to write `<yawn>` would
#: be tied to this engine, which is what § 5 exists to prevent.
_NATIVE_TAG = re.compile(r"<[A-Za-z_ ]+>")

#: `[laugh]`, for each cue this engine claims. The core has already removed the ones it does not.
_CUE = re.compile(r"\[(" + "|".join(re.escape(cue) for cue in CUE_TAGS) + r")\]")

_WHITESPACE = re.compile(r"\s+")


def translate_cues(text: str) -> str:
    """The standard vocabulary in Orpheus's syntax, with whitespace collapsed."""
    text = _NATIVE_TAG.sub(" ", text)
    text = _CUE.sub(lambda match: CUE_TAGS[match.group(1)], text)
    return _WHITESPACE.sub(" ", text).strip()


def segments(text: str, limit: int = SEGMENT_CHARACTERS) -> list[str]:
    """Text in pieces of at most `limit` characters, broken where a reader would pause.

    The SDK's splitter, so that this engine and Dia cannot drift apart on it: `_fit` and `_pack`
    here and in `rhapsode_engine_dia.prompt` were the same twenty lines, character for character.
    protocol.md § 8.
    """
    return text_segments(text, limit)


def prompt(voice: str, segment: str) -> str:
    """The text a finetuned voice is asked for in, as upstream formats it."""
    return f"{voice}: {segment}"


def framed(token_ids: list[int]) -> list[int]:
    """A tokenised prompt with the special tokens the finetune was trained with around it."""
    return [START_OF_HUMAN, *token_ids, *END_OF_PROMPT]
