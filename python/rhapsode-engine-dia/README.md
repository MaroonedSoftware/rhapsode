# rhapsode-engine-dia

Dia as a rhapsode engine.

Dia is Nari Labs' 1.6B dialogue model, run here through transformers' `DiaForConditionalGeneration`.
It writes nonverbals where they happen and performs all eight standard cues, and it makes two
speakers in one pass: `/dialogue` (protocol.md § 6) as well as `/speak`.

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
- **Dialogue:** two speakers. A speaker with a voice is read from its clip; one without is read in
  a voice the model picks, which a `seed` holds fixed. Two cloned clips together leave room to speak
  only up to about 28 s, so 5 to 10 s of each.
- **Variants:** `1.6b`, the June 2025 checkpoint. 6.4 GB of weights and 0.3 GB of codec, fetched
  from pinned revisions.
- **Languages:** English.

## How it reads a long text

Dia reads 5 to 20 seconds well: less sounds unnatural and more gets fast, in upstream's words. So a
long text is cut into pieces broken where a reader would pause, and each is one generation. Dia
picks a new voice on every generation unless it is given one, so every piece continues from a
prompt: a cloned voice's clip and transcript, or for a request with no voice its own first piece,
which is kept to about 130 characters. A generation holds about 35 seconds with its prompt, so each
later piece is sized to what the prompt leaves, at most 250 characters.

A conversation is cut the same way, into windows of whole turns, and a speaker who goes on talking
is kept as one turn, because upstream says the tags must alternate. Speakers with a voice are `[S1]`
and `[S2]` first, so the text the model is given begins with `[S1]` as upstream requires.

Each generation is whole before any of it is sent, so a long request streams piece by piece.

## Measured

On an RTX 4070 Ti SUPER, bfloat16: the model loads in 2.5 s and holds 3.3 GiB, speaking peaks at
4.0 GiB and a cloned voice at 4.9 GiB. It speaks at 1.2 to 1.4 times real time. A 9.2 s line was
ready in 7.5 s; a 26.5 s text arrived piece by piece, the first after 5.2 s. `rhapsode-conform`
passes all 47 checks it can decide, and the 48th is blending, which Dia has no voices to do.

On an Apple Silicon laptop, in float32 on Metal, it runs at about a tenth of real time: enough to
hear it, not enough to use it. A seed reproduces a request bit for bit on both.
