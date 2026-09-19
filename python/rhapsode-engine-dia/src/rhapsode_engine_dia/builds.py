"""What each Dia build can do, and where its weights live.

One build so far, Nari Labs' 1.6B model as of its June 2025 checkpoint, run through transformers'
`DiaForConditionalGeneration` rather than upstream's own `nari-tts` package: that package pins
`torch==2.6.0` and has had no functional commit since July 2025, while the transformers port is
maintained with the library. Dia2 is a different model with a different codec, and would be a second
build beside this one rather than a new version of it.

The evidence for everything claimed here is upstream's README (nari-labs/dia) and the checkpoint's
own config files, read at the revision pinned below (September 2026).
"""

from __future__ import annotations

from rhapsode_worker import Variant

#: All eight of the standard vocabulary: upstream lists a tag for each. Upstream also says of every
#: one of its 21 tags that it "might result in unexpected output", and ranks none of them above the
#: others, so claiming all eight is claiming what upstream claims. The real-weights check is where one
#: that never performs would be dropped. protocol.md § 8.
CUES: tuple[str, ...] = ("laugh", "chuckle", "sigh", "gasp", "cough", "clear throat", "sniff", "groan")

#: How each cue is written for this model. Upstream's tags are parenthesised stage directions, mostly
#: in the third person, and the model learned them as plain text. `chuckle` is upstream's own spelling.
CUE_TAGS: dict[str, str] = {
    "laugh": "(laughs)",
    "chuckle": "(chuckle)",
    "sigh": "(sighs)",
    "gasp": "(gasps)",
    "cough": "(coughs)",
    "clear throat": "(clears throat)",
    "sniff": "(sniffs)",
    "groan": "(groans)",
}

#: Every nonverbal upstream lists, verbatim. A client that writes one of these by hand is removed
#: before translation, so the only way to make this engine laugh is the standard vocabulary: one that
#: learned to write `(burps)` would be tied to this engine, which is what § 5 exists to prevent. Only
#: these, and not every parenthesis, because "(finally)" in a sentence is prose.
NATIVE_TAGS: tuple[str, ...] = (
    "laughs",
    "clears throat",
    "sighs",
    "gasps",
    "coughs",
    "singing",
    "sings",
    "mumbles",
    "beep",
    "groans",
    "sniffs",
    "claps",
    "screams",
    "inhales",
    "exhales",
    "applause",
    "burps",
    "humming",
    "sneezes",
    "chuckle",
    "whistles",
)

#: (min, max, default). Defaults are the checkpoint's own `generation_config.json`: guidance 3.0,
#: temperature 1.8, top-p 0.90. Upstream's native package defaults to a temperature of 1.2 instead, and
#: which of the two reads better is a question for the real-weights check. A guidance scale of 1 turns
#: classifier-free guidance off entirely, which is where the range stops.
CFG_SCALE_RANGE = (1.0, 5.0, 3.0)
TEMPERATURE_RANGE = (0.5, 2.0, 1.8)
TOP_P_RANGE = (0.5, 1.0, 0.9)

DIALS: dict[str, tuple[float, float, float]] = {
    "cfgScale": CFG_SCALE_RANGE,
    "temperature": TEMPERATURE_RANGE,
    "topP": TOP_P_RANGE,
}

#: The checkpoint, at one revision, so a re-upload upstream cannot change what an installed engine
#: loads. Apache-2.0 and ungated.
REPOSITORY = "nari-labs/Dia-1.6B-0626"
REVISION = "ef2795fcc29c5abe6ffc91fd33808588b49bbc66"

#: Only what transformers reads, named file by file. The repository carries the same 6.4 GB of weights
#: three times over, as safetensors shards, as `pytorch_model.bin` and as upstream's own `dia-v1.pth`,
#: and a snapshot of all of it would be 19.3 GB for one model.
FILES: tuple[str, ...] = (
    "audio_tokenizer_config.json",
    "config.json",
    "generation_config.json",
    "model-00001-of-00002.safetensors",
    "model-00002-of-00002.safetensors",
    "model.safetensors.index.json",
    "preprocessor_config.json",
    "special_tokens_map.json",
    "tokenizer_config.json",
)

#: The codec that turns the model's codes into a waveform, which the processor loads from its own
#: repository by the name in `audio_tokenizer_config.json`. MIT, ungated, 307 MB, 44.1 kHz.
CODEC_REPOSITORY = "descript/dac_44khz"
CODEC_REVISION = "c1bc521685adf9cfe247bc39a5ca58917eda1ac4"
CODEC_FILES: tuple[str, ...] = ("config.json", "model.safetensors", "preprocessor_config.json")

#: The one build, named for its size so that Dia2's two can sit beside it without renaming it.
DEFAULT_VARIANT = "1.6b"


def variants() -> dict[str, Variant]:
    """What the build performs.

    No deliveries: Dia has no whisper and no intensity control, and a word it cannot perform is one it
    must not claim. The dials are its sampling, which upstream exposes and nothing else. English only,
    which upstream says in so many words.
    """
    return {DEFAULT_VARIANT: Variant(cues=CUES, deliveries=(), dials=dict(DIALS), languages=("en",))}
