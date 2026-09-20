"""Breaking text where a reader would pause. protocol.md § 8.

Three adapters wrote this before it was here, and two of them wrote it identically: `_fit` and
`_pack` in `rhapsode_engine_dia.prompt` and `rhapsode_engine_orpheus.prompt` were the same twenty
lines character for character, down to the two regular expressions. Kokoro had a third copy, weaker
in two ways nobody chose: no clause fallback, so a sentence longer than the limit reached the model
whole, and a sentence pattern missing the ellipsis the other two matched.

Splitting text is not engine knowledge. The size of a piece is, and stays with the adapter.
"""

from __future__ import annotations

import re

#: Where one sentence ends and the next begins.
SENTENCE_END = re.compile(r"(?<=[.!?…])\s+")

#: Where a reader pauses inside a sentence, used only when a whole sentence will not fit.
CLAUSE_END = re.compile(r"(?<=[,;:])\s+")

#: A cue as § 5 writes one, or a run of non-space characters.
#:
#: The cue alternative is first and therefore wins, which is what keeps `[clear throat]` whole when
#: the word pass runs. Orpheus and Dia never needed this because both translate cues into their own
#: engine's spelling before splitting, and both spellings happen to be space-free; the SDK splits
#: the text the core passed down, where a two-word cue is still two words with a space in it.
WORD = re.compile(r"\[[^\[\]]*\]|\S+")


def segments(text: str, limit: int) -> list[str]:
    """Text in pieces of at most `limit` characters, broken where a reader would pause.

    Sentences first, then clauses, then words, and packed back together greedily so that a run of
    short sentences is one generation rather than several. A single word longer than the limit stays
    whole: splitting it would have the model read two halves of a word.
    """
    pieces = [piece for sentence in SENTENCE_END.split(text.strip()) for piece in _fit(sentence, limit)]
    return _pack([piece for piece in pieces if piece], limit)


def _fit(sentence: str, limit: int) -> list[str]:
    if len(sentence) <= limit:
        return [sentence]
    clauses = CLAUSE_END.split(sentence)
    if len(clauses) > 1:
        return [piece for clause in clauses for piece in _fit(clause, limit)]
    return _pack(WORD.findall(sentence), limit)


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
