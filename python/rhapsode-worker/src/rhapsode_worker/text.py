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
from collections.abc import Callable

#: Han, kana and the CJK punctuation and fullwidth forms: the scripts written without spaces.
#:
#: Hangul is left out on purpose. Korean puts spaces between words, so the whitespace rules already
#: break it, and gluing two Hangul pieces back together without a space would fuse two words.
CJK = (
    "　-〿"  # CJK symbols and punctuation: 。、「」
    "぀-ヿ"  # hiragana and katakana
    "㐀-䶿"  # Han, extension A
    "一-鿿"  # Han
    "豈-﫿"  # Han compatibility
    "＀-￯"  # fullwidth forms: ！？，：；
    "\U00020000-\U0003ffff"  # Han, extensions B onwards
)

#: What may follow a full stop and still belong to its sentence: `他说：「好。」` ends after the `」`.
_CLOSE = "」』）〕》〉”’"

#: Where one sentence ends and the next begins.
#:
#: Latin script ends a sentence with whitespace after the stop. Chinese and Japanese put none there,
#: so before the CJK alternatives 420 characters of `今天天气很好。` were one sentence, then one
#: clause, then one word, and reached the model as one piece of 420 against a limit of 300. A stop
#: followed by another stop or a closing bracket is not the end yet, or `真的吗？！` would come apart
#: between its two marks. An ellipsis breaks without a space only before CJK, so `Well…I` is
#: unchanged.
SENTENCE_END = re.compile(
    r"(?<=[.!?…])\s+"
    rf"|(?<=[。！？])(?![{_CLOSE}。！？…])\s*"
    rf"|(?<=[。！？…][{_CLOSE}])(?![{_CLOSE}])\s*"
    rf"|(?<=…)(?=[{CJK}])"
)

#: Where a reader pauses inside a sentence, used only when a whole sentence will not fit.
#:
#: The CJK comma, enumeration comma, semicolon and colon need no space after them for the same
#: reason the stops do.
CLAUSE_END = re.compile(r"(?<=[,;:])\s+|(?<=[，、；：])\s*")

#: A run of non-space characters, in which a cue as § 5 writes one counts as a single character.
#:
#: Treating the cue as one character is what keeps `[clear throat]` whole when the word pass runs.
#: Orpheus and Dia never needed this because both translate cues into their own engine's spelling
#: before splitting, and both spellings happen to be space-free; the SDK splits the text the core
#: passed down, where a two-word cue is still two words with a space in it. It has to hold inside a
#: word as well as between words, because Chinese puts no space either side of a cue: a cue
#: standing alone as its own word was not enough, and `今天[clear throat]很好` came apart at the space.
WORD = re.compile(r"(?:\[[^\[\]]*\]|[^\s\[])+|\S")

#: The units a CJK run is cut into when it has no break point at all: a cue, a run of anything not
#: CJK (so a Latin name inside Chinese is never cut), or one CJK character with any punctuation that
#: follows it, so that no piece begins with the `。` that ended the one before.
_UNIT = re.compile(rf"\[[^\[\]]*\]|[^\s\[{CJK}]+|.[。！？，、；：…{_CLOSE}]*")

_IS_CJK = re.compile(rf"[{CJK}]")


def segments(text: str, limit: int) -> list[str]:
    """Text in pieces of at most `limit` characters, broken where a reader would pause.

    Sentences first, then clauses, then words, and packed back together greedily so that a run of
    short sentences is one generation rather than several. A single word longer than the limit stays
    whole: splitting it would have the model read two halves of a word. A run of Chinese or Japanese
    with no punctuation in it is the exception, and is cut at the limit, because there every
    character is a place a word can end and the alternative is one piece of any length.
    """
    pieces = [piece for sentence in SENTENCE_END.split(text.strip()) for piece in _fit(sentence, limit)]
    return _pack([piece for piece in pieces if piece], limit)


def _fit(sentence: str, limit: int) -> list[str]:
    if len(sentence) <= limit:
        return [sentence]
    clauses = [clause for clause in CLAUSE_END.split(sentence) if clause]
    if len(clauses) > 1:
        return [piece for clause in clauses for piece in _fit(clause, limit)]
    return _pack([piece for word in WORD.findall(sentence) for piece in _cut(word, limit)], limit)


def _cut(word: str, limit: int) -> list[str]:
    if len(word) <= limit or not _IS_CJK.search(word):
        return [word]
    return _pack(_UNIT.findall(word), limit, joint=_nothing)


def _pack(pieces: list[str], limit: int, joint: Callable[[str, str], str] | None = None) -> list[str]:
    between = joint or _joint
    packed: list[str] = []
    current = ""
    for piece in pieces:
        gap = between(current, piece)
        if current and len(current) + len(gap) + len(piece) > limit:
            packed.append(current)
            current = piece
        else:
            current = f"{current}{gap}{piece}" if current else piece
    if current:
        packed.append(current)
    return packed


def _joint(left: str, right: str) -> str:
    """Nothing between two CJK characters, which is where the text had nothing; a space otherwise."""
    if left and right and _IS_CJK.match(left[-1]) and _IS_CJK.match(right[0]):
        return ""
    return " "


def _nothing(left: str, right: str) -> str:
    """The joint inside one cut word, which had no space anywhere in it."""
    return ""
