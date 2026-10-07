"""What StyleTTS 2 can do, and where its weights are. protocol.md § 4."""

from __future__ import annotations

from rhapsode_worker import Variant

#: The multi-speaker checkpoint upstream trained on LibriTTS, and the reference clips it shipped with.
REPOSITORY = "yl4579/StyleTTS2-LibriTTS"
REVISION = "3aa7ba7f8f275ec13dce21682a61494c35089e2a"

CONFIG = "Models/LibriTTS/config.yml"
CHECKPOINT = "Models/LibriTTS/epochs_2nd_00020.pth"
REFERENCES = "reference_audio.zip"

#: SHA-256 of each file at REVISION, checked before anything is unpickled. The checkpoint pickles
#: `getattr`, which torch since 2.6 refuses unless told the file is trusted; a revision pins what the
#: Hub serves, and this pins what arrived.
SHA256 = {
    CONFIG: "0bbe2ea77a05b1f10d11144c68c1148a56d50d49b3b3660a1e8ffbef2041310e",
    CHECKPOINT: "1164ffe19a17449d2c722234cecaf2836b35a698fb8ffd42562d2663657dca0a",
    REFERENCES: "d25b4950ec39cec5a00f5061491ad0b3606edc6618a54adc59663bfd6e6ab55e",
}
FILES = tuple(SHA256)

#: The one build, named for the corpus it was trained on, so an LJSpeech build can sit beside it.
DEFAULT_VARIANT = "libritts"

SAMPLE_RATE = 24_000

#: How much of the predicted style replaces the reference's: `alpha` for timbre, `beta` for prosody.
#: 0 is the reference alone and 1 the text's own prediction. Upstream's demo defaults.
ALPHA_RANGE = (0.0, 1.0, 0.3)
BETA_RANGE = (0.0, 1.0, 0.7)
#: Steps of the style diffusion. Upstream's demo runs 5 and 10; more is slower and more varied.
DIFFUSION_STEPS_RANGE = (3.0, 20.0, 5.0)
#: Classifier-free guidance on the text's embedding. Upstream's demo raises it to 2 for a more
#: emotional reading; 1 is no guidance.
EMBEDDING_SCALE_RANGE = (1.0, 10.0, 1.0)

#: The speakers in upstream's reference clips that are from LibriTTS or LibriSpeech, the corpora it
#: was trained on, both CC BY 4.0. Upstream's condition on the weights, that listeners be told the
#: speech is synthetic, does not reach a speaker from the training set (its README). The other clips
#: in the archive are of people the corpus does not name, and are left out. Id, then file, then the
#: corpus's speaker.
STOCK = {
    "libritts_696": "696_92939_000016_000006.wav",
    "libritts_1789": "1789_142896_000022_000005.wav",
    "librispeech_1221": "1221-135767-0014.wav",
    "librispeech_4077": "4077-13754-0000.wav",
    "librispeech_5639": "5639-40744-0020.wav",
    "librispeech_908": "908-157963-0027.wav",
}
#: Upstream's demo voice.
DEFAULT_VOICE = "libritts_696"


def variants() -> dict[str, Variant]:
    """One build. No cues: the model has no tags, so the core strips every one before it gets here.

    English only. PL-BERT, which the model reads text through, was trained on English Wikipedia, and
    the phoneme set has no symbol for a French nasal vowel, so `Bonjour` loses its `ɔ̃`. A language
    eSpeak can phonemize is not one this checkpoint can speak.
    """
    return {
        DEFAULT_VARIANT: Variant(
            dials={
                "alpha": ALPHA_RANGE,
                "beta": BETA_RANGE,
                "diffusionSteps": DIFFUSION_STEPS_RANGE,
                "embeddingScale": EMBEDDING_SCALE_RANGE,
            },
            languages=("en",),
        )
    }
