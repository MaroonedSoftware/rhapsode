"""What the model is given: its nonverbal tags, its speaker tags, and text in pieces it reads well.

Pure, so every decision about text is testable without a model.
"""

from __future__ import annotations

import re
from collections.abc import Iterable

from rhapsode_worker import segments as text_segments

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

#: How long one generation can be, prompt included: the checkpoint's 3072 decoder positions at
#: upstream's 86 a second.
GENERATION_SECONDS = 3072 / 86

#: How fast Dia is assumed to read when sizing a piece to the room left beside its prompt. Slow on
#: purpose, because a piece read slower than assumed is one cut off mid-word: measured on real
#: weights it read 604 characters in 29.1 s (20.8 a second) and a 97 character line with a laugh in
#: 10.3 s (9.4, trailing silence included).
CHARACTERS_PER_SECOND = 12

#: Kept free of every generation, so a piece that reads slower than the rule of thumb still ends.
SPARE_SECONDS = 3.0

#: The first piece of an unvoiced request, which every later piece continues from and so pays for
#: in positions. About 9 s: past the 5 s upstream says sounds unnatural, and short enough to leave
#: a full piece beside it.
ANCHOR_CHARACTERS = 130

#: The least a piece is given however long its prompt, so a long prompt makes many short pieces
#: rather than none.
FEWEST_CHARACTERS = 60

#: Anything already written in the model's own syntax: its nonverbal tags, and its speaker tags, which
#: in a line spoken by one voice would hand the rest of the line to somebody else.
_NATIVE_TAG = re.compile(
    r"\((?:" + "|".join(re.escape(tag) for tag in NATIVE_TAGS) + r")\)|\[S[12]\]",
    re.IGNORECASE,
)

#: `[laugh]`, for each cue this engine claims. The core has already removed the ones it does not.
_CUE = re.compile(r"\[(" + "|".join(re.escape(cue) for cue in CUE_TAGS) + r")\]")

_WHITESPACE = re.compile(r"\s+")


def translate_cues(text: str) -> str:
    """The standard vocabulary in Dia's syntax, with whitespace collapsed."""
    text = _NATIVE_TAG.sub(" ", text)
    text = _CUE.sub(lambda match: CUE_TAGS[match.group(1)], text)
    return _WHITESPACE.sub(" ", text).strip()


def segments(text: str, limit: int = SEGMENT_CHARACTERS) -> list[str]:
    """Text in pieces of at most `limit` characters, broken where a reader would pause.

    The SDK's splitter. Packing short sentences back together matters more here than for most
    engines, because a short generation is one Dia reads badly, and that is a property of the
    packing rather than of this engine: `_fit` and `_pack` here and in
    `rhapsode_engine_orpheus.prompt` were the same twenty lines, character for character.
    protocol.md § 8.
    """
    return text_segments(text, limit)


#: Audio tokens a second, upstream's figure and the one GENERATION_SECONDS is derived from.
TOKENS_PER_SECOND = 86

#: The slowest reading a piece is budgeted for, well under the 9.4 characters a second measured on
#: real weights, so the budget is never the thing that ends a piece somebody is still listening to.
SLOWEST_CHARACTERS_PER_SECOND = 8

#: On top of the reading, for a laugh, a pause, or the breath at the end. Two seconds rather than
#: four because the budget is what stops a text the model will not: measured on an RTX 4070 Ti SUPER,
#: "one" used every second it was given, so at four it made 4.8 s where a ten-word line made 4.2 s,
#: and a shorter text still made more audio than a longer one.
SLACK_SECONDS = 2.0


def tokens_for(characters: int) -> int:
    """How long a generation of this much text may run before it is cut off.

    Dia does not always stop. Measured on an RTX 4070 Ti SUPER: "one" ran to 27 s of murmur, where
    "one two three four five six seven eight nine ten" stopped by itself after 3.8 s, so a shorter
    text made more audio than a longer one. Unbounded, that is a request nobody asked for filling a
    card and a listener's ears; bounded this generously, a piece that ends early is one the model
    was not going to finish anyway.
    """
    seconds = characters / SLOWEST_CHARACTERS_PER_SECOND + SLACK_SECONDS
    return int(seconds * TOKENS_PER_SECOND)


def room(prompt_seconds: float) -> int:
    """How many characters fit in a generation beside a prompt this long, up to a whole piece."""
    seconds = GENERATION_SECONDS - prompt_seconds - SPARE_SECONDS
    return max(FEWEST_CHARACTERS, min(SEGMENT_CHARACTERS, int(seconds * CHARACTERS_PER_SECOND)))


def line(segment: str) -> str:
    """One voice's segment as the model is given it."""
    return f"{FIRST_SPEAKER} {segment}"


#: One speaker's words in a conversation, under the tag the model knows them by.
Said = tuple[str, str]


def script(turns: Iterable[tuple[str, str]], tags: dict[str, str]) -> list[Said]:
    """A conversation's turns as the model is given them: each under its speaker's tag, in Dia's
    syntax, and a speaker who goes on talking kept as one turn, since upstream says the tags must
    alternate. A turn that is nothing once Dia's own tags are removed is dropped."""
    said: list[Said] = []
    for speaker, text in turns:
        words = translate_cues(text)
        if not words:
            continue
        tag = tags[speaker]
        if said and said[-1][0] == tag:
            said[-1] = (tag, f"{said[-1][1]} {words}")
        else:
            said.append((tag, words))
    return said


def take(said: list[Said], limit: int) -> tuple[list[Said], list[Said]]:
    """As many whole turns as fit in `limit` characters of speech, and what is left.

    A turn too long to fit alone is broken where a reader would pause, and its remainder stays at
    the front of what is left, under the same tag. Never nothing, so a conversation always moves on.
    """
    taken: list[Said] = []
    spoken = 0
    rest = list(said)
    while rest:
        tag, words = rest[0]
        if spoken + len(words) <= limit:
            taken.append(rest.pop(0))
            spoken += len(words)
            continue
        if not taken:
            first, *remainder = segments(words, limit)
            taken.append((tag, first))
            rest[0] = (tag, " ".join(remainder))
            if not remainder:
                rest.pop(0)
        break
    return taken, rest


def windows(said: list[Said], limit: int) -> list[list[Said]]:
    """The whole conversation, in pieces of whole turns that each fit in `limit`."""
    pieces: list[list[Said]] = []
    rest = said
    while rest:
        piece, rest = take(rest, limit)
        pieces.append(piece)
    return pieces


def rendered(said: list[Said]) -> str:
    """Turns as the model reads them: `[S1] words [S2] words`."""
    return " ".join(f"{tag} {words}" for tag, words in said)
