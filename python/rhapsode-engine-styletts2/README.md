# rhapsode-engine-styletts2

StyleTTS 2 as a rhapsode engine.

StyleTTS 2 is Yinghao Aaron Li's style-diffusion model from 2023, which its paper reports matching
human recordings on VCTK and outperforming the publicly available models of the time at zero-shot
cloning on LibriTTS. It clones from a few seconds of audio and nothing else: no transcript, no
training. It is small and fast: 191M parameters, 1.2 GiB resident, and several times realtime on a
laptop's CPU.

**Its code is MIT and its weights are MIT, with one condition from upstream's README:** listeners
must be told the speech is synthesised, unless the person whose voice is cloned has given permission.
The six stock voices are speakers from the corpus it was trained on, which the condition does not
reach. The worker phonemizes through phonemizer and eSpeak NG, which are GPL, so what runs is
GPL-3.0-or-later (protocol.md § 4).

## Where upstream's code comes from

Upstream is a repository of scripts with no packaging, and inference imports `models.py`,
`text_utils.py`, `Modules/` and `Utils/` from its root. `Utils/` also holds three of the checkpoints
the model is built from, the text aligner, the pitch extractor and PL-BERT, which are not on the
Hugging Face Hub. The package on PyPI called `styletts2` is a third party's from January 2024 that
pins langchain below 0.2 and swaps eSpeak's phonemes for gruut's.

So a pull, or the first load, downloads upstream's archive at a pinned commit, keeps those four and
the licence, and checks the unpacked files against a pinned digest, into
`~/.cache/rhapsode/styletts2/<commit>`, or wherever `RHAPSODE_STYLETTS2_SOURCE` points. The weights
come from `yl4579/StyleTTS2-LibriTTS` at a pinned revision, each file checked against a pinned
SHA-256. Both checks matter more here than usual: upstream's checkpoints are pickles that torch 2.6
and later refuses to load as untrusted, and a file whose every byte is pinned is the only kind this
adapter tells torch to trust.

## What it can do

- **Voices:** six stock voices, speakers from LibriTTS and LibriSpeech (CC BY 4.0) taken from
  upstream's own reference clips, `libritts_696` being upstream's demo voice and the default. A clone
  is any clip of 3 to 20 seconds, as WAV, MP3, FLAC or Ogg.
- **Dials:**
  - `alpha` (0 to 1, default 0.3): how much of the timbre comes from the text's predicted style
    rather than the clip.
  - `beta` (0 to 1, default 0.7): the same for prosody. Lower sounds more like the clip, higher more
    like the text.
  - `diffusionSteps` (3 to 20, default 5): steps of the style diffusion. Slower and more varied as
    it rises.
  - `embeddingScale` (1 to 10, default 1): guidance toward the text. Upstream's demo raises it to 2
    for a more emotional reading.
- **No cues and no deliveries.** The model has no tags, so the core strips every cue before it gets
  here.
- **English only.** PL-BERT, which the model reads text through, was trained on English Wikipedia,
  and the phoneme set has no symbol for a French nasal vowel: `Bonjour` loses its `ɔ̃`. eSpeak can
  phonemize eighty languages; this checkpoint can speak one.
- **A seed reproduces the audio**, bit for bit, on the same device.

## How it reads a long text

PL-BERT's position embeddings stop at 512 phoneme tokens, and past them the model fails outright.
English measured 1.18 tokens to a character, so 473 tokens for 400 characters and 589 for 500. The
SDK cuts text at 300 characters, which measured 356 tokens and 19.6 s of speech, and leaves room for
text that spells out long. Figures spell out longest: `$1,234,567.89` is 13 characters and 100
tokens, and a 58-character sentence of a price, a date and a time is 223. A piece still over the
limit is cut in two at the nearest pause and each half tried again, so 354 characters of nothing
but figures read through as 74 s of speech rather than failing.

Pieces are joined with no pause added. Each generation already opens with about 260 ms of silence
and closes with 320 to 480, so two pieces are 0.6 s apart, a sentence's pause.

The style is read from the clip on every request rather than kept. It measured 10 ms on Metal and
70 ms on the CPU, against 470 ms and 1.5 s for the speech it styles.

## Measured

On an M-series Mac with torch 2.14.1 and transformers 5.19, Python 3.14, on 7 October 2026:

- **`rhapsode-conform` against a real install: all 41 checks pass** on Metal, including a seed
  reproducing the audio, a clone speaking, previewing and deleting, and text past
  `segmentCharacters` being spoken.
- **Memory:** `modelBytes` 1.2 GiB on Metal.
- **Speed**, upstream's 127-character demo sentence, 8.2 s of speech, warm: 0.5 to 1.2 s on Metal
  (7x to 16x realtime, varying with what else the machine was doing) and 2.1 s on the CPU (4x). The
  first generation after a load is about 3 s slower on Metal while kernels are built.
- **Load:** 3.8 s warm, of which 0.29 s is the SHA-256 of the checkpoint. The first load in a new
  virtualenv took 26 s, compiling bytecode.
- **Download:** 141 MB from GitHub and 774 MB from the Hub, 174 s on a home connection.
- **Fidelity to upstream:** with the same seed on the CPU, the adapter's audio is bit for bit the
  audio of upstream's own demo notebook.
