"""What the model is given: its nonverbal tags, its speaker tags, and text in pieces it reads well.

Pure, so every decision about text is testable without a model.
"""

from __future__ import annotations

import re

from .builds import CUE_TAGS, NATIVE_TAGS

#: The first speaker's tag, which upstream says every input must begin with. The tokenizer reads text
#: as UTF-8 bytes and has exactly two tokens that are not bytes, this and `[S2]`.
FIRST_SPEAKER = "[S1]"

#: How much text one generation is given. Upstream warns that under about 5 s of audio "will sound
#: unnatural" and over about 20 s "will make the speech unnaturally fast". English is read at roughly
#: 15 characters a second, which puts 250 characters at about 17 s, inside the window with room for a
#: laugh. The rate is a rule of thumb rather than a measurement of this model. It also keeps a segment
#: far inside the encoder's 1024 bytes, past which the tokenizer truncates without a word.
SEGMENT_CHARACTERS = 250

#: Anything already written in the model's own syntax: its nonverbal tags, and its speaker tags, which
#: in a line spoken by one voice would hand the rest of the line to somebody else.
_NATIVE_TAG = re.compile(
    r"\((?:" + "|".join(re.escape(tag) for tag in NATIVE_TAGS) + r")\)|\[S[12]\]",
    re.IGNORECASE,
)

#: `[laugh]`, for each cue this engine claims. The core has already removed the ones it does not.
_CUE = re.compile(r"\[(" + "|".join(re.escape(cue) for cue in CUE_TAGS) + r")\]")

_SENTENCE_END = re.compile(r"(?<=[.!?…])\s+")
_CLAUSE_END = re.compile(r"(?<=[,;:])\s+")
_WHITESPACE = re.compile(r"\s+")


def translate_cues(text: str) -> str:
    """The standard vocabulary in Dia's syntax, with whitespace collapsed."""
    text = _NATIVE_TAG.sub(" ", text)
    text = _CUE.sub(lambda match: CUE_TAGS[match.group(1)], text)
    return _WHITESPACE.sub(" ", text).strip()


def segments(text: str, limit: int = SEGMENT_CHARACTERS) -> list[str]:
    """Text in pieces of at most `limit` characters, broken where a reader would pause.

    Sentences first, then clauses, then words, and packed back together greedily so that a run of
    short sentences is one generation rather than several, which matters more here than for most
    engines because a short generation is one Dia reads badly. A single word longer than the limit
    stays whole. A tag translated to `(clears throat)` has a space in it, so the word pass could part
    it from itself; the limit is far longer than any tag, so that can only happen to a tag that lands
    exactly on a boundary, and it is read as the two words it then is.
    """
    pieces = [piece for sentence in _SENTENCE_END.split(text) for piece in _fit(sentence, limit)]
    return _pack([piece for piece in pieces if piece], limit)


def line(segment: str) -> str:
    """One voice's segment as the model is given it."""
    return f"{FIRST_SPEAKER} {segment}"


def _fit(sentence: str, limit: int) -> list[str]:
    if len(sentence) <= limit:
        return [sentence]
    clauses = _CLAUSE_END.split(sentence)
    if len(clauses) > 1:
        return [piece for clause in clauses for piece in _fit(clause, limit)]
    return _pack(sentence.split(" "), limit)


def _pack(pieces: list[str], limit: int) -> list[str]:
    packed: list[str] = []
    current = ""
    for piece in pieces:
        if current and len(current) + 1 + len(piece) > limit:
            packed.append(current)
            current = piece
        else:
            current = f"{current} {piece}" if current else piece
    if current:
        packed.append(current)
    return packed
