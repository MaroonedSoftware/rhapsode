# rhapsode-engine-dia

Dia as a rhapsode engine.

Dia is Nari Labs' 1.6B dialogue model, run here through transformers' `DiaForConditionalGeneration`.
It writes nonverbals where they happen and performs all eight standard cues. It was trained to make
two speakers in one pass, and this adapter speaks one voice through `/speak`.

From the root of a checkout, the SDK first, because the engine pins it exactly and neither is on PyPI
yet:

```bash
python -m venv /opt/rhapsode/venvs/dia
/opt/rhapsode/venvs/dia/bin/pip install python/rhapsode-worker python/rhapsode-engine-dia
```

`pnpm wizard install dia`, or the web page, does this and the config below for you.

Then in `rhapsode.config.json`:

```json
{ "engines": { "dia": { "venv": "/opt/rhapsode/venvs/dia" } } }
```

## What it can do

- **Cues:** all eight, each as the parenthesised tag upstream lists for it: `[laugh]` becomes
  `(laughs)`. Upstream says of every tag that it "might result in unexpected output", so a cue is
  asked for rather than guaranteed.
- **Deliveries:** none. Dia has no whisper and no intensity control.
- **Dials:** `cfgScale`, `temperature` and `topP`, defaulting to the checkpoint's own 3.0, 1.8
  and 0.9. No `speed`.
- **Voices:** none of its own. A request that names none is read in whichever voice the model picks,
  which a `seed` holds fixed. Cloning takes a clip and a `transcript` of it, 5 to 10 seconds of
  speech and at most 20.
- **Variants:** `1.6b`, the June 2025 checkpoint. 6.4 GB of weights and 0.3 GB of codec, fetched
  from pinned revisions.
- **Languages:** English.

## How it reads a long text

Dia reads 5 to 20 seconds well: less sounds unnatural and more gets fast, in upstream's words. So a
long text is cut into pieces of at most 250 characters, broken where a reader would pause, and each is
one generation. Dia picks a new voice on every generation unless it is given one, so every piece
after the first continues from the first, its audio and its words as the prompt. A cloned voice's
clip is the prompt for every piece instead.

Each generation is whole before any of it is sent, so a long request streams piece by piece.

## Measured

On an Apple Silicon laptop, in float32 on Metal: a 10.3 s line took 105 s to make, so about a tenth
of real time, and two requests with the same seed were bit-identical. Upstream measured bfloat16 on
an RTX 4090 at 1.5 times real time in 4.4 GB of VRAM, which is what this build loads on an NVIDIA
card.
