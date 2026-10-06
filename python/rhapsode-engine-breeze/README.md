# rhapsode-engine-breeze

Breeze TTS 2 as a rhapsode engine.

Breeze TTS 2 is BreezeBlue's 3B model, released in August 2026, and the highest-ranked open-weight
model on the Artificial Analysis speech arena, ahead of ElevenLabs' Eleven v3. It speaks English and
Chinese and clones from a clip and its exact transcript.

**The weights are for research and non-commercial use only**, and so is what you make with them on
your own hardware. The inference code is Apache-2.0; the BreezeBlue Research and Non-Commercial
License governs the weights, derivative models and self-hosted outputs. An install has to accept it
by name (protocol.md § 10).

**It needs an NVIDIA card with CUDA.** Upstream's runtime runs on nothing else, so on a Mac or a
CPU box the worker refuses to start and says so. Eager inference holds about 7.7 GiB, and upstream's
minimum is a 12 GB card.

Upstream's inference code has no packaging, so it comes from `rhapsode-vendor-breeze`, a copy of
breezeblue-ai/breeze-tts at one commit, installed beside this package. From the root of a checkout:

```bash
python -m venv /opt/rhapsode/venvs/breeze
/opt/rhapsode/venvs/breeze/bin/pip install python/rhapsode-worker python/rhapsode-vendor-breeze python/rhapsode-engine-breeze
```

Then in `rhapsode.config.json`:

```json
{ "engines": { "breeze": { "venv": "/opt/rhapsode/venvs/breeze" } } }
```

## What it can do

- **Cues:** all eight, each heard performed on real weights in English and in Chinese: `[sigh]`
  becomes `(sigh)` and `[叹气]`. Not always the open card's spelling: `[laugh]` becomes `(laughs)`,
  BreezeBlue's hosted-docs spelling, because the card's `(laugh)` was heard not to laugh.
- **Deliveries:** none yet. An instruction can steer the model, and is how `hushed` and `frantic`
  would be performed, once it is heard to hold for a whole line.
- **Dials:** `temperature` and `topP`, defaulting to upstream's 0.9 and 1.0. No `speed`, and no
  `cfgScale`: guidance needs an instruction, which no request can carry yet.
- **Voices:** none of its own. Cloning takes a clip and its exact `transcript`, 5 to 10 seconds of
  clean speech and at most 20.
- **Variants:** `2`, the August 2026 release. 7.0 GB of weights and 0.7 GB of audio tokenizer,
  fetched from a pinned revision, by a pull ahead of the first load or by that load.
- **Languages:** English and Chinese.

## How it reads a long text

Upstream's plain template has no voice of its own and picks a new speaker on every generation, so a
long text would be read by somebody new at every piece. A request with no voice therefore has its
first piece kept to about 9 seconds, and every later piece clones that piece's audio and words. A
cloned voice is the prompt for every piece instead. Pieces are at most 300 characters.

The model streams: each piece's audio is passed on in upstream's own chunks of 160 ms as it is made,
rather than when the piece is whole.

## Measured

On an RTX 4070 Ti SUPER, eager, through the worker: the model loads in 8.5 s from a warm cache and
holds 7.6 GiB (`modelBytes` 7.75 GB), about 8.0 GiB on the card while speaking. It speaks at 1.02 to
1.05 times real time, so a stream keeps up with playback with little to spare. The first audio of a
request arrives in 0.22 s once the model is warm, and 1.4 s on the first request after a load. A
35 s text of seven sentences, three generations cloning the first, took 34.6 s.

**A seed reproduces the tokens and not the audio.** Three seeded runs of one line made identical
codec frames, 75 of them, and three different waveforms: the same length, identical for the first
7,680 samples, then apart by at most 0.03 at a correlation of 0.998. The difference is upstream's
streaming codec. It is not cuDNN's algorithm choice, and it is not an op PyTorch knows to be
nondeterministic: `use_deterministic_algorithms` flagged none and changed nothing but the speed, which
it halved. § 6 allows a seed that does not reproduce, and `rhapsode-conform` then reports the cue
checks as undecided rather than passed, so whether each is performed is a question for a listener. On a
card with nothing else on it, it passes all 36 of the checks it can decide. A first run passed 35: the
36th was a reload that ran out of memory because two other processes had taken 7.4 GiB of the card.

An unload gives the card back. Three cycles of load, speak and unload each returned it to 307 MiB, the
CUDA context the worker process keeps, and each reload took 1.4 to 1.5 s from a warm cache. Breeze
holds no model in a reference cycle: its own unload, before any collection, left 0.00 GiB of the
7.18 it loaded.

The install is one pip resolve, on Python 3.12: torch 2.9.1 with CUDA 12.8, transformers 4.57.3 and
qwen-tts 0.1.1. qwen-tts prints that SoX is missing and flash-attn is not installed when it is
imported; the eager path needs neither.
