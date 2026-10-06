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

- **Cues:** `laugh`, `sigh`, `cough` and `clear throat`, the four the open model's card spells:
  `[laugh]` becomes `(laugh)` in English and `[笑]` in Chinese. BreezeBlue's hosted model has more,
  spelled differently, and those wait for a check on real weights.
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
