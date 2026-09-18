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

## Which builds a box gets

The package installs the backend that runs where it lands without compiling anything:

- **Linux x86_64: vLLM, and the `full` build.** The finetune unquantised, from unsloth's ungated
  bfloat16 copy (6.6 GB), on an NVIDIA card. The worker lists `full` only when it sees CUDA.
  llama-cpp-python is a source package there, and the server image has no C++ compiler to build it.
- **Everywhere else, such as a Mac: llama.cpp, and `q8` and `q4`.**

A Linux box without an NVIDIA card installs the GGUF builds instead, which needs a C++ compiler:

```bash
/opt/rhapsode/venvs/orpheus/bin/pip install 'rhapsode-engine-orpheus[llama]'
```

The default is the first build the worker lists: `full` where it can run, then `q8`.

Measured on an RTX 4070 Ti SUPER in the server image, beside another engine holding 5.3 GB: `full`
loaded in 17 to 26 seconds, streamed at 1.05 times real time with the first audio after 0.34
seconds, and held 7.5 GB. vLLM claims 7 GiB of the card up front.
`RHAPSODE_ORPHEUS_GPU_MEMORY` in the engine's `env`, as a fraction of the card, overrides that.

On an Apple M5 Pro, `q8` ran at about a quarter of real time: fine for `stream: false`, too slow
to feed a live stream.
