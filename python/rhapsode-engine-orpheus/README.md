# rhapsode-engine-orpheus

Orpheus as a rhapsode engine.

Orpheus is a Llama 3.2 3B finetuned by Canopy Labs to emit SNAC audio codes instead of text. Its
tags perform seven of the eight standard cues, which makes it the second engine here that can laugh,
and it generates token by token, so it streams audio as it goes, not by chunking a finished
waveform.

```bash
python -m venv /opt/rhapsode/venvs/orpheus
/opt/rhapsode/venvs/orpheus/bin/pip install rhapsode-engine-orpheus
```

Then in `rhapsode.config.json`:

```json
{ "engines": { "orpheus": { "venv": "/opt/rhapsode/venvs/orpheus" } } }
```

## What it can do

- **Cues:** `laugh`, `chuckle`, `sigh`, `gasp`, `cough`, `sniff` and `groan`. Not `clear throat`,
  which Orpheus has no tag for, so the core strips it before the model sees it.
- **Deliveries:** none. Orpheus cannot whisper.
- **Dials:** `temperature`, `topP` and `repetitionPenalty`, with upstream's defaults. Raising the
  first or the last makes the reading faster.
- **Voices:** the finetune's eight, `tara` first. No cloning.
- **Variants:** `q8` (3.5 GB, the default) and `q4` (2.1 GB), the same finetune at two precisions,
  run through llama.cpp on Metal, CUDA or the CPU. On a CUDA box with vLLM, also `full`: Canopy's
  own weights, unquantised.

## The `full` build

```bash
/opt/rhapsode/venvs/orpheus/bin/pip install 'rhapsode-engine-orpheus[vllm]'
```

Linux and a CUDA card only, and the worker lists `full` only where both are true. The weights are
gated: accept the terms on [the model page](https://huggingface.co/canopylabs/orpheus-3b-0.1-ft),
then give the engine a token in its `env`:

```json
{ "engines": { "orpheus": { "venv": "/opt/rhapsode/venvs/orpheus", "env": { "HF_TOKEN": "hf_..." } } } }
```

The download is 15.2 GB of float32, named file by file: the repository itself is 56.7 GB, because it
also holds the optimizer state from training. vLLM claims a fixed share of the card when it loads,
10 GiB worth by default. `RHAPSODE_ORPHEUS_GPU_MEMORY` in the same `env`, as a fraction of the card,
overrides that. Nobody has run this build on a CUDA card yet, so treat both numbers as a starting
point.
