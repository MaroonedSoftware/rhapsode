"""What each Chatterbox build can actually do, and why they differ.

This file is the reason the capability document has two levels. Upstream ships three builds that are
not three sizes of one thing: `turbo` performs the paralinguistic tags and IGNORES the expressiveness
dials, while `original` and `multilingual` honour the dials and perform no tags. On this engine you
get cues or dials and never both, and which one is a fact about the weights resident right now.

The evidence is upstream's own source. `ChatterboxTurboTTS.generate` defaults `exaggeration` and
`cfg_weight` to 0.0 and logs "CFG, min_p and exaggeration are not supported by Turbo version and will
be ignored" if either arrives above it; `ChatterboxTTS.generate` defaults both to 0.5 and uses them.
"""

from __future__ import annotations

from rhapsode_worker import Variant

#: The standard vocabulary, all of which the turbo weights perform as bracketed tags in the text.
CUES: tuple[str, ...] = (
    "laugh",
    "chuckle",
    "sigh",
    "gasp",
    "cough",
    "clear throat",
    "sniff",
    "groan",
)

#: Upstream's documented neutral, and the value an omitted field would have got on the dialled builds.
NEUTRAL_EXAGGERATION = 0.5
NEUTRAL_CFG_WEIGHT = 0.5

#: Ranges as declared to a client. Upstream clamps neither, and its guidance never goes above 1 for
#: cfg_weight; exaggeration above 1 is unusual but is what "as expressive as it goes" means here.
EXAGGERATION_RANGE = (0.0, 2.0, NEUTRAL_EXAGGERATION)
CFG_WEIGHT_RANGE = (0.0, 1.0, NEUTRAL_CFG_WEIGHT)

#: What `hushed` and `frantic` become, as an OFFSET from wherever the voice already is.
#:
#: Upstream's guidance is the whole of the evidence: 0.5 and 0.5 are neutral, an expressive reading
#: wants exaggeration around 0.7 or more, higher exaggeration speeds a reading up, and a lower CFG
#: weight slows it back down. So `frantic` raises exaggeration and leaves CFG weight alone, because
#: the pace it gains is part of what makes it frantic, and `hushed` lowers both: less expression, and
#: the slower, more deliberate pacing a lower CFG weight brings.
#:
#: They are starting points rather than measurements, and this table is the one place to tune by ear.
DELIVERY_OFFSETS: dict[str, dict[str, float]] = {
    "hushed": {"exaggeration": -0.25, "cfgWeight": -0.2},
    "frantic": {"exaggeration": 0.4, "cfgWeight": 0.0},
}

#: What upstream's multilingual build accepts. Keep in step with `chatterbox.mtl_tts`.
MULTILINGUAL_LANGUAGES: tuple[str, ...] = (
    "en",
    "ar",
    "da",
    "de",
    "el",
    "es",
    "fi",
    "fr",
    "he",
    "hi",
    "it",
    "ja",
    "ko",
    "ms",
    "nl",
    "no",
    "pl",
    "pt",
    "ru",
    "sv",
    "sw",
    "tr",
    "zh",
)


def variants() -> dict[str, Variant]:
    """The three builds, each claiming only what its weights actually perform.

    Claiming a cue this engine cannot perform is the one way to break the guarantee that an engine
    never reads the word "laugh" out loud, and it would be trivially easy here: the cues and the
    dials are one dictionary apart.
    """
    return {
        "turbo": Variant(
            cues=CUES,
            deliveries=(),
            # Empty, and not as an oversight. Passing either dial to this build produces a warning
            # upstream and changes nothing, which is precisely the silent discard the capability
            # document exists to make impossible.
            dials={},
            languages=("en",),
        ),
        "original": Variant(
            cues=(),
            deliveries=("hushed", "frantic"),
            dials={"exaggeration": EXAGGERATION_RANGE, "cfgWeight": CFG_WEIGHT_RANGE},
            languages=("en",),
        ),
        "multilingual": Variant(
            cues=(),
            deliveries=("hushed", "frantic"),
            dials={"exaggeration": EXAGGERATION_RANGE, "cfgWeight": CFG_WEIGHT_RANGE},
            languages=MULTILINGUAL_LANGUAGES,
        ),
    }


def clamp(value: float, low: float, high: float) -> float:
    """Clamped and rounded, so that 0.8 + 0.4 goes out as 1.2 rather than a float's idea of it."""
    return round(max(low, min(high, value)), 4)
