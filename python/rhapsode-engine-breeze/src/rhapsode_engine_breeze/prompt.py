"""What the model is given: its event tags, in the language being spoken, and text in pieces.

Pure, so every decision about text is testable without a model.
"""

from __future__ import annotations

import re

from rhapsode_worker import segments as text_segments

from .builds import CUE_TAGS, NATIVE_TAGS_EN, NATIVE_TAGS_ZH

#: How much text one generation is given. BreezeBlue's own hosted service splits Chinese text at 500
#: characters, the only figure upstream publishes. 300 is smaller on purpose: Chinese is read at
#: roughly four or five characters a second, so 500 of them is close to two minutes, against the
#: 1500 frames (120 s at 12.5 a second) upstream's `infer.py` lets one generation run. 300 is about
#: a minute of Chinese and about 20 s of English, and leaves room in the 2048 positions for a cloned
#: voice's clip and transcript. A rule of thumb rather than a measurement of this model.
SEGMENT_CHARACTERS = 300

#: Anything already written in the model's own syntax. Its event tags in either language, whatever
#: the language of the request, since a Chinese tag in an English line is the same back door. Its
#: speaker tag, which upstream's templates write as `[S0]` and a client could use to start a second
#: speaker. And its instruction and audio markers, which the tokenizer reads as special tokens: an
#: `<ins_bos>` in the text would turn the rest of a line into a direction to the model rather than
#: words to say.
_NATIVE_TAG = re.compile(
    r"\((?:"
    + "|".join(re.escape(tag) for tag in NATIVE_TAGS_EN)
    + r")\)|\[(?:"
    + "|".join(re.escape(tag) for tag in NATIVE_TAGS_ZH)
    + r")\]|\[S\d+\]|<ins_(?:bos|eos)>|<\|[^|<>]*\|>",
    re.IGNORECASE,
)

#: `[laugh]`, for each cue this engine claims. The core has already removed the ones it does not.
_CUE = re.compile(r"\[(" + "|".join(re.escape(cue) for cue in CUE_TAGS["en"]) + r")\]")

_WHITESPACE = re.compile(r"\s+")


def translate_cues(text: str, language: str = "en") -> str:
    """The standard vocabulary in Breeze's syntax for `language`, with whitespace collapsed.

    A language the build does not speak never reaches here, because the core refuses it first
    (§ 6), so an unknown one is a bug and fails loudly rather than falling back to English tags.
    """
    tags = CUE_TAGS[language]
    text = _NATIVE_TAG.sub(" ", text)
    text = _CUE.sub(lambda match: tags[match.group(1)], text)
    return _WHITESPACE.sub(" ", text).strip()


def segments(text: str, limit: int = SEGMENT_CHARACTERS) -> list[str]:
    """Text in pieces of at most `limit` characters, broken where a reader would pause.

    The SDK's splitter, run after translation so a cue is already in the model's spelling. It breaks
    only at whitespace, so Chinese written without spaces is one word to it and reaches the model
    whole: 420 characters of `今天天气很好。` came back as one piece of 420. That is a gap in the shared
    splitter rather than in this engine, and is fixed there. protocol.md § 8.
    """
    return text_segments(text, limit)
