# rhapsode-engine-kokoro

[Kokoro](https://huggingface.co/hexgrad/Kokoro-82M) as a rhapsode engine, through
[kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx). It runs on the CPU and brings no torch, which
makes it the engine to install first: no GPU, a download measured in megabytes, and speech faster than
realtime on a laptop.

```bash
pnpm wizard install kokoro
```

It needs Python 3.11 to 3.13: 3.11 for the SDK, and below 3.14 because kokoro-onnx says so. With uv on the path the installer fetches one;
without it, set `install.python` to an interpreter in that range.

## What it can do

Three variants, which are the same model at three precisions: `fp16` (the default), `fp32` and `int8`.
They claim the same things: no cues, no deliveries, one dial, `speed` (0.5 to 2.0), which is also what
the OpenAI shim's `speed` maps to. English only for now, in 28 voices; each voice's first letter is its
accent, `a` American and `b` British. No cloning.

## Licences

The weights are Apache-2.0 and commercially usable. The code the worker runs is GPL-3.0-or-later,
because kokoro-onnx turns text into phonemes with phonemizer and eSpeak NG. This package is MIT, and the
catalog reports the GPL, because that is the licence a commercial user needs to know about.

## What it costs

Measured on an Apple Silicon Mac, on the CPU, September 2026, for a 6.2 s line:

| Variant | Download | Load | Speed |
| --- | --- | --- | --- |
| `fp16` | 177 MB | 0.31 s | 9.9x realtime |
| `fp32` | 326 MB | 0.48 s | 8.3x realtime |
| `int8` | 92 MB | 0.25 s | 2.5x realtime |

Through the core, `fp16` speaks at 8.5x to 9.2x realtime once warm, and a first `/speak` (spawn, load,
speak) took 1.75 s for 6.2 s of audio. The adapter passes all 27 conformance checks against the real
weights, on all three variants. That run was on Python 3.14 with the version cap overridden by hand,
because no 3.13 was to hand; the installer will not do that for you.

Every variant also needs the 28 MB voices file. The weights land in `~/.cache/rhapsode/kokoro`, or
`RHAPSODE_KOKORO_WEIGHTS`, and are checked against a SHA-256 as they arrive.

## One thing to know

eSpeak NG reads its data from a path inside the engine's virtualenv, and exits the whole process if
that path is 160 characters or longer. The adapter refuses to load rather than let that happen, and
says so; the cure is a shorter `install.venvDir`.
