"""What each Fish Audio build can do, and where its weights live.

One build, S2 Pro as Fish Audio released it on 10 March 2026: a dual-autoregressive model, 4B
parameters along time and 400M across the codec's ten codebooks, trained on more than 10M hours in
80-odd languages. It is second among open weights on the Artificial Analysis speech arena (1117 Elo
when this was written), and the most expressive of them: its tags are free-form directions rather
than a fixed list.

The weights are for research and non-commercial use only, under the Fish Audio Research License,
and so is upstream's inference code: `fish-speech` declares the same licence in its own pyproject.

The evidence for everything claimed here is the model card and fishaudio/fish-speech at 214da3c,
read at the revisions pinned below in October 2026.
"""

from __future__ import annotations

from rhapsode_worker import Variant

#: Two of the eight standard cues, each heard performed on real weights (an RTX 4070 Ti SUPER,
#: October 2026). The card's list of common tags has words for four, and a listener heard no sigh where
#: `[sigh]` was written and no throat cleared where `[clearing throat]` was, so those two are not
#: claimed and the core strips them before they get here (§ 5). The card says the model takes any
#: description in brackets, so other spellings may perform, but a cue is claimed only once it is heard.
CUES: tuple[str, ...] = ("laugh", "chuckle")

#: How each cue is written for this model, each spelled as the card's list spells it. Tags are English
#: words whatever the language spoken; the card gives them no other spelling.
CUE_TAGS: dict[str, str] = {
    "laugh": "[laughing]",
    "chuckle": "[chuckle]",
}

#: (min, max, default), every one upstream's own: the bounds `ServeTTSRequest` validates and the
#: defaults it fills in. Its repetition penalty is a dial here because S2 Pro, like every
#: autoregressive model, can loop, and the penalty is upstream's answer to that.
TEMPERATURE_RANGE = (0.1, 1.0, 0.8)
TOP_P_RANGE = (0.1, 1.0, 0.8)
REPETITION_PENALTY_RANGE = (0.9, 2.0, 1.1)

DIALS: dict[str, tuple[float, float, float]] = {
    "temperature": TEMPERATURE_RANGE,
    "topP": TOP_P_RANGE,
    "repetitionPenalty": REPETITION_PENALTY_RANGE,
}

#: The card's first two tiers. It names 80-odd languages, but ranks only these ten as the ones it
#: does well, and a language a client picks from this list should be one it will want to hear.
LANGUAGES: tuple[str, ...] = ("en", "zh", "ja", "ko", "es", "pt", "ar", "ru", "fr", "de")

#: The checkpoint, at one revision, so a re-upload upstream cannot change what an installed engine
#: loads. The card asks for a country, a date and a non-commercial checkbox, but the gate is not
#: enforced: a request without a token resolves every file.
REPOSITORY = "fishaudio/s2-pro"
REVISION = "1de9996b6be38b745688de084d87a5633f714e4e"

#: Only what the runtime reads, named file by file: 9.1 GB of model in two shards and 1.9 GB of codec.
#: The card's overview image is left behind.
FILES: tuple[str, ...] = (
    "chat_template.jinja",
    "codec.pth",
    "config.json",
    "model-00001-of-00002.safetensors",
    "model-00002-of-00002.safetensors",
    "model.safetensors.index.json",
    "special_tokens_map.json",
    "tokenizer.json",
    "tokenizer_config.json",
)

#: The one build, named as upstream names it, so that a smaller S2 can sit beside it.
DEFAULT_VARIANT = "s2-pro"


def variants() -> dict[str, Variant]:
    """What the build performs.

    No deliveries yet. `[whisper]` and `[low voice]` are on the card's list, and are how `hushed`
    would be performed, but the card describes its tags as working "at the word level", and whether
    one at the head of a line holds for the whole of it is a question for real weights. A word it
    cannot perform is one it must not claim.
    """
    return {DEFAULT_VARIANT: Variant(cues=CUES, deliveries=(), dials=dict(DIALS), languages=LANGUAGES)}
