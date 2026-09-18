"""What each Orpheus build can do, and where its weights live.

Every build is the same finetune (`canopylabs/orpheus-3b-0.1-ft`) at a different precision, so unlike
Chatterbox the variants do not differ in what they can perform. They differ in what they cost: a
Q8_0 GGUF is 3.5 GB and a Q4_K_M is 2.1 GB, and on a card shared with another engine that is the
difference between two residents and one.

The evidence for everything claimed here is upstream's README and `orpheus_tts` package
(canopyai/Orpheus-TTS, September 2026).
"""

from __future__ import annotations

from rhapsode_worker import Variant

#: The standard vocabulary, minus `clear throat`, which Orpheus has no tag for. Claiming it anyway is
#: the one dishonesty the protocol cannot catch: the core would pass `[clear throat]` through and the
#: model would read it out loud. protocol.md § 8.
CUES: tuple[str, ...] = ("laugh", "chuckle", "sigh", "gasp", "cough", "sniff", "groan")

#: How each cue is written for this model. Upstream's tags are angle-bracketed plain text, which the
#: finetune learned to perform. `sniff` is `<sniffle>` upstream. `<yawn>` is upstream's too but not
#: in the standard vocabulary, and stays unreachable until a second engine can yawn. § 5.
CUE_TAGS: dict[str, str] = {cue: f"<{cue}>" for cue in CUES} | {"sniff": "<sniffle>"}

#: The finetune's voices, in upstream's own order of "conversational realism". A voice is a name the
#: model was trained to follow in the prompt, and not a file, so there is nothing to clone into.
VOICES: tuple[str, ...] = ("tara", "leah", "jess", "leo", "dan", "mia", "zac", "zoe")

#: Upstream's default, and the voice its own examples use. A request naming no voice gets this one,
#: which § 6 allows ("absent means the engine default"); a request naming an unknown one does not.
DEFAULT_VOICE = "tara"

#: (min, max, default). Defaults are upstream's `generate_tokens_sync` defaults. Upstream says a
#: repetition penalty of at least 1.1 "is required for stable generations", so that is the floor, and
#: raising it or the temperature makes the reading faster. The other bounds are not measured: they
#: fence off greedy decoding at one end and noise at the other, and the real-weights check is where to
#: tighten them by ear.
TEMPERATURE_RANGE = (0.1, 1.5, 0.6)
TOP_P_RANGE = (0.1, 1.0, 0.8)
REPETITION_PENALTY_RANGE = (1.1, 2.0, 1.3)

DIALS: dict[str, tuple[float, float, float]] = {
    "temperature": TEMPERATURE_RANGE,
    "topP": TOP_P_RANGE,
    "repetitionPenalty": REPETITION_PENALTY_RANGE,
}

#: The GGUF builds, from one repository at one revision so that `q8` and `q4` are two precisions of
#: the same conversion and a re-upload upstream cannot change what an installed engine loads. These
#: are community quantisations (unsloth) of Canopy's finetune. The repository is ungated, where
#: Canopy's own safetensors ask for an account and a token.
GGUF_REPOSITORY = "unsloth/orpheus-3b-0.1-ft-GGUF"
GGUF_REVISION = "e2b00302c46af8205f521f60016600aa25a068e6"
GGUF_FILES: dict[str, str] = {
    "q8": "orpheus-3b-0.1-ft-Q8_0.gguf",
    "q4": "orpheus-3b-0.1-ft-Q4_K_M.gguf",
}

#: The finetune unquantised, for the `full` build on vLLM: unsloth's bfloat16 copy of Canopy's
#: weights, the same conversion the GGUFs come from. Canopy's own repository is gated, so it needs an
#: account and a token, and it holds the weights in float32 beside the optimizer and FSDP state from
#: training, 56.7 GB where this is 6.6. vLLM runs the model in bfloat16 either way.
FULL_REPOSITORY = "unsloth/orpheus-3b-0.1-ft"
FULL_REVISION = "eae2b6e5e429c81b95ac42a883ac64f126583d43"

#: Only what inference reads, named file by file, so a later upload beside them is never fetched.
FULL_FILES: tuple[str, ...] = (
    "config.json",
    "generation_config.json",
    "model.safetensors.index.json",
    "model-00001-of-00002.safetensors",
    "model-00002-of-00002.safetensors",
    "special_tokens_map.json",
    "tokenizer.json",
    "tokenizer_config.json",
)

#: The codec that turns the model's codes into a waveform. MIT, ungated, 80 MB.
SNAC_REPOSITORY = "hubertsiuzdak/snac_24khz"
SNAC_REVISION = "d73ad176a12188fcf4f360ba3bf2c2fbbe8f58ec"


def variants(*, gguf: bool = True, full: bool = False) -> dict[str, Variant]:
    """Every build claims the same thing, because every build is the same finetune.

    No deliveries: Orpheus has no whisper and no intensity control, and a word it cannot perform is
    one it must not claim. The sampling dials are real ones: upstream documents that the temperature
    and repetition penalty change the pace of the reading.

    Each build is declared only where it can load, which the engine decides: a variant listed on a box
    that cannot run it is a promise every load of it breaks. protocol.md § 4.
    """
    claimed = Variant(cues=CUES, deliveries=(), dials=dict(DIALS), languages=("en",))
    # Unquantised first where it can run, then the larger quantisation: the first is the default.
    names = (*(("full",) if full else ()), *(GGUF_FILES if gguf else ()))
    return {name: claimed for name in names}
