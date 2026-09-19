# rhapsode-engine-chatterbox

Chatterbox as a rhapsode engine.

This is the engine the capability document was designed around, and the reason it has two levels.
The `turbo` and `nano` builds perform the paralinguistic tags and discard the expressiveness dials;
`original` and `multilingual` honour the dials and perform no tags. So on this engine you get cues or
dials and never both, and which one is a fact about the weights that are resident right now.

`nano` is turbo's architecture with a smaller backbone, 110M parameters, loaded through turbo's own
class. It claims exactly what turbo claims. It is in no upstream release yet, which is why this package
installs upstream from a pinned commit on its master rather than from PyPI.

Its cues are performed, not only accepted. Its tokenizer has turbo's tags as the same tokens, and in
September 2026 each of the eight lengthened the same cloned line on every one of three seeds, by
more than on turbo (`[chuckle]` 1.0 s against 0.6 s). A level measure cannot tell a soft chuckle
from a breath, so `[chuckle]` and `[laugh]` were checked by ear against turbo's, and both are there.
One listen through the core alone had missed the chuckle, which is why it was checked twice.

From the root of a checkout, the SDK first, because the engine pins it exactly and neither is on PyPI
yet:

```bash
python -m venv /opt/rhapsode/venvs/chatterbox
/opt/rhapsode/venvs/chatterbox/bin/pip install python/rhapsode-worker python/rhapsode-engine-chatterbox
```

`pnpm wizard install chatterbox`, or the web page, does this and the config below for you.

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
- `nano` is a 3.0 GB fetch, of which it loads 1.9 GB: upstream's loader also downloads a 1.06 GB
  `s3gen.safetensors` that nano never reads.

## Nano against turbo

Measured through the adapter on an Apple M5 Pro, September 2026, pinned upstream commit `5de7a54`.
One 98-character English line with a cue in it, about 5 to 6 s of audio. Each figure is the median of
five warm runs after one discarded. "Realtime" is seconds of audio per second of wall clock.

| build   | device | load     | stock voice   | cloned voice  |
| ------- | ------ | -------- | ------------- | ------------- |
| `nano`  | MPS    | 9 s      | 5.0x realtime | 3.7x realtime |
| `turbo` | MPS    | 13 s     | 2.7x realtime | 1.3x realtime |
| `nano`  | CPU    | 8–30 s   | 1.5–2.3x      | 0.9–1.4x      |
| `turbo` | CPU    | 25 s     | 0.8x          | 0.9x          |

The CPU rows are ranges because the machine was busy while they were taken (a load average of 9 to 14
on 18 cores), and torch used 6 threads. Upstream says nano is 3x realtime on 8 CPU cores; it was
not here. On a Mac, MPS is the device for either build.

The cloned column was measured when every request analysed its reference clip again, a second or
more of each, because upstream's `generate` does that whenever it is handed a path. The adapter now
analyses a voice once per resident build and keeps the result, so only a voice's first request after
a load pays for it. Afterwards a warm clone cost what the stock voice did: nano 3.6x realtime against
3.6x, turbo 1.9x against 1.7x, taken once on a machine too busy for the absolute figures to stand
beside the table's. An entry is 1.3 MB on nano and 0.8 MB on original, and the 32 most recently used
voices are kept.

Apple Silicon works through MPS with no configuration. The residency figures in the protocol (memory
stranded by an OOM, the share an unload reclaims) were measured on CUDA and are not verified on
unified memory.
