"""What the model is given: its tags, its speaker, and text in pieces.

Pure, so every decision about text is testable without a model.
"""

from __future__ import annotations

import re

from rhapsode_worker import segments as text_segments

from .builds import CUE_TAGS

#: The speaker every single-voice line is read as. Upstream's `generate_long` splits its text on these
#: tags and adds one to a prompt that has none, so a line is given one rather than left to guess.
SPEAKER = "<|speaker:0|>"

#: How much text one generation is given: upstream's own server default, `chunk_length` 200. Upstream
#: counts it in UTF-8 bytes and this in characters, which is the same in English and three times
#: upstream's figure in Chinese or Japanese. A rule of thumb from upstream rather than a measurement
#: of this model.
SEGMENT_CHARACTERS = 200

#: Anything in square brackets. For most engines a bracket that is not a cue is prose and stays, but
#: this model reads any bracketed description as a direction (the card says 15,000 of them and counting),
#: so `[redacted]` in a sentence would be performed rather than read. Every one is either a cue this
#: engine claims, which becomes its tag, or is removed. protocol.md § 5.
_BRACKETS = re.compile(r"\[([^\[\]]*)\]")

#: The model's special tokens: a speaker tag written by hand would hand the rest of a line to
#: somebody else, and the others are its chat template's.
_SPECIAL = re.compile(r"<\|[^|<>]*\|>")

_WHITESPACE = re.compile(r"\s+")


def _bracket(match: re.Match[str]) -> str:
    return CUE_TAGS.get(match.group(1), " ")


def translate_cues(text: str) -> str:
    """The standard vocabulary in Fish's syntax, every other bracket removed, whitespace collapsed.

    One pass rather than strip-then-translate, because both syntaxes are square brackets: `[sigh]` is
    a cue and the model's own tag at once, and a strip that ran first would take it.
    """
    text = _SPECIAL.sub(" ", text)
    text = _BRACKETS.sub(_bracket, text)
    return _WHITESPACE.sub(" ", text).strip()


def segments(text: str, limit: int = SEGMENT_CHARACTERS) -> list[str]:
    """Text in pieces of at most `limit` characters, broken where a reader would pause.

    The SDK's splitter, run after translation so a cue is already in the model's spelling. It breaks
    only at whitespace, so Chinese or Japanese written without spaces reaches the model whole; that is
    a gap in the shared splitter rather than in this engine. protocol.md § 8.
    """
    return text_segments(text, limit)


def line(segment: str) -> str:
    """One voice's segment as the model is given it."""
    return f"{SPEAKER}{segment}"
