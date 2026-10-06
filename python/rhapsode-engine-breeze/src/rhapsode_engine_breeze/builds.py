"""What each Breeze build can do, and where its weights live.

One build, Breeze TTS 2 as BreezeBlue released it on 25 August 2026: a 3B model over the Qwen3-TTS
audio tokenizer, bilingual in English and Chinese, cloning from a clip and its exact transcript. It
ranks first among open weights on the Artificial Analysis speech arena (1216 Elo when this was
written, ahead of ElevenLabs' Eleven v3 at about 1177), which is the reason to have it.

The weights are for research and non-commercial use only. The inference code is Apache-2.0, so a
licence scanner reads this engine as commercial and is wrong in exactly the way § 4 exists for.

The evidence for everything claimed here is the model card and the inference repository
(breezeblue-ai/breeze-tts at 58ec70c), read at the revisions pinned below in October 2026. BreezeBlue's
hosted documentation describes a different model, `breeze-tts-2-multilingual`, whose tags are spelled
differently, and is cited only where it is the only source.
"""

from __future__ import annotations

from rhapsode_worker import Variant

#: Four of the eight standard cues: the ones the open model's card names, in English and in Chinese.
#: The hosted docs list `(chuckles)`, `(gasps)`, `(sniffs)` and `(groans)` too, but for the hosted
#: multilingual model, which spells the four claimed here differently (`(laughs)` where the open card
#: writes `(laugh)`, `[清嗓]` where it writes `[清嗓子]`). A spelling the open weights never saw is read
#: out loud, so those four wait for the real-weights check. protocol.md § 8.
CUES: tuple[str, ...] = ("laugh", "sigh", "cough", "clear throat")

#: How each cue is written for this model, per language. The card's own rule: parentheses in English,
#: square brackets in Chinese, and never one syntax inside the other language.
CUE_TAGS: dict[str, dict[str, str]] = {
    "en": {
        "laugh": "(laugh)",
        "sigh": "(sigh)",
        "cough": "(cough)",
        "clear throat": "(clears throat)",
    },
    "zh": {
        "laugh": "[笑]",
        "sigh": "[叹气]",
        "cough": "[咳嗽]",
        "clear throat": "[清嗓子]",
    },
}

#: Every English event either source spells, without its parentheses: the open card's four and the
#: hosted docs' thirty-four. A client that writes one by hand is removed before translation, so the
#: only way to make this engine laugh is the standard vocabulary. Only these, and not every
#: parenthesis, because "(finally)" in a sentence is prose. protocol.md § 5.
NATIVE_TAGS_EN: tuple[str, ...] = (
    "laugh",
    "sigh",
    "cough",
    "clears throat",
    "laughs",
    "chuckles",
    "giggles",
    "crying",
    "sobs",
    "whimpers",
    "groans",
    "moans",
    "sighs",
    "gasps",
    "inhales",
    "exhales",
    "breathing heavily",
    "whispers",
    "shouts",
    "screams",
    "singing",
    "humming",
    "stutters",
    "pause",
    "coughs",
    "sniffs",
    "smacks lips",
    "clicks tongue",
    "yawns",
    "sneezes",
    "hiccups",
    "burps",
    "gulps",
    "gags",
    "grunts",
    "scoffs",
    "snorts",
)

#: The same for Chinese, in square brackets: the open card's four and the hosted docs' thirty-four.
NATIVE_TAGS_ZH: tuple[str, ...] = (
    "笑",
    "叹气",
    "咳嗽",
    "清嗓子",
    "轻笑",
    "咯咯笑",
    "哭声",
    "抽泣",
    "呜咽",
    "呻吟",
    "哀号",
    "惊呼",
    "吸气",
    "呼气",
    "喘息",
    "耳语",
    "喊叫",
    "惨叫",
    "唱歌",
    "哼歌",
    "结巴",
    "停顿",
    "清嗓",
    "吸鼻子",
    "咂嘴",
    "啧嘴",
    "打哈欠",
    "打喷嚏",
    "打嗝",
    "打饱嗝",
    "吞咽",
    "干呕",
    "闷哼",
    "冷笑",
    "哼鼻子",
)

#: (min, max, default). The defaults are what upstream's `update_generation_config_for_breeze` sets
#: for both the backbone and the depth decoder: temperature 0.9, top-p 1.0, top-k 50.
#:
#: No `cfgScale`, although upstream has one, because it means nothing yet: the plain and the cloning
#: templates define no negative prompt, and `prepare_inputs` raises on any guidance scale but 1 for
#: them. Guidance exists for the instruction templates (voice design and voice direction), which no
#: request in this contract can reach. A dial every request refuses is the silent discard § 11
#: refuses, one layer down.
TEMPERATURE_RANGE = (0.5, 1.5, 0.9)
TOP_P_RANGE = (0.5, 1.0, 1.0)

DIALS: dict[str, tuple[float, float, float]] = {
    "temperature": TEMPERATURE_RANGE,
    "topP": TOP_P_RANGE,
}

#: The checkpoint, at one revision, so a re-upload upstream cannot change what an installed engine
#: loads. Ungated: a request without a token resolves every file.
REPOSITORY = "BreezeBlue/Breeze-TTS-2"
REVISION = "3e28c5151381a722f1d8661b4118c298caa77aa4"

#: Only what the runtime reads, named file by file: 7.0 GB of model in two shards and 0.7 GB of audio
#: tokenizer, which upstream bundles in the same repository and refuses to load without. The README's
#: logo and leaderboard image are left behind.
FILES: tuple[str, ...] = (
    "audio_tokenizer/config.json",
    "audio_tokenizer/configuration.json",
    "audio_tokenizer/model.safetensors",
    "audio_tokenizer/preprocessor_config.json",
    "config.json",
    "generation_config.json",
    "model-00001-of-00002.safetensors",
    "model-00002-of-00002.safetensors",
    "model.safetensors.index.json",
    "special_tokens_map.json",
    "tokenizer.json",
    "tokenizer_config.json",
)

#: The one build, named for the release, since BreezeBlue's next model is not a size of this one.
DEFAULT_VARIANT = "2"


def variants() -> dict[str, Variant]:
    """What the build performs.

    No deliveries yet. The model can be steered by an instruction ("speak slowly, with a restrained,
    serious tone"), which is how `hushed` and `frantic` would be performed, but whether an instruction
    holds for a whole line is a question for real weights, and a word it cannot perform is one it
    must not claim.
    """
    return {DEFAULT_VARIANT: Variant(cues=CUES, deliveries=(), dials=dict(DIALS), languages=("en", "zh"))}
