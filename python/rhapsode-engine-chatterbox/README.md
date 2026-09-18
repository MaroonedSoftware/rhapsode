# rhapsode-engine-chatterbox

Chatterbox as a rhapsode engine.

This is the engine the capability document was designed around, and the reason it has two levels.
The `turbo` build performs the paralinguistic tags and discards the expressiveness dials; `original`
and `multilingual` honour the dials and perform no tags. So on this engine you get cues or dials and
never both, and which one is a fact about the weights that are resident right now.

```bash
python -m venv /opt/rhapsode/venvs/chatterbox
/opt/rhapsode/venvs/chatterbox/bin/pip install rhapsode-engine-chatterbox
```

Then in `rhapsode.config.json`:

```json
{ "engines": { "chatterbox": { "venv": "/opt/rhapsode/venvs/chatterbox", "env": { "CUDA_VISIBLE_DEVICES": "0" } } } }
```

The weights are MIT and commercially usable, which the catalog says before you install anything.

## What it costs to install

Measured on an Apple Silicon Mac (MPS), September 2026:

- The virtualenv, torch included, is 1.5 GB.
- The weights come from Hugging Face the first time each variant loads, and land in
  `~/.cache/huggingface`. `turbo` is 3.8 GB, and all three variants together are 9.7 GB.
- Loading `turbo` once it is cached takes about 10 s. A first `/speak` through the core (spawn, load,
  speak) took 17 s, and a warm one about 1 s for 2.4 s of audio.

Apple Silicon works through MPS with no configuration. The residency figures in the protocol (memory
stranded by an OOM, the share an unload reclaims) were measured on CUDA and are not verified on
unified memory.
