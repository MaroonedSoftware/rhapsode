# rhapsode-engine-phonon

[Phonon](https://huggingface.co/gradium/phonon-31m-en) as a rhapsode engine, through Gradium's
[ptts](https://github.com/gradium-ai/xn-ptts) runtime. It runs on the CPU and brings no torch, its
download is 75 MB, and it streams many times faster than realtime.

```bash
pnpm wizard install phonon
```

It needs nothing beyond the Python the SDK does. On Linux and Windows x86_64, the runtime's wheels
need a CPU with AVX2.

## What it can do

One build, `31m`: English, with no cues and no deliveries. It does not clone or blend, and it speaks
38 voices: the checkpoint's own `default`, which a request naming no voice gets, and the 37 English
voices in [gradium/phonon-voices](https://huggingface.co/gradium/phonon-voices). Voice ids are the
catalog's names with spaces replaced, so `Zoey` is `Zoey` and `The Thing Under the Stairs` is
`The-Thing-Under-the-Stairs`.

Two dials:

- **`durationDelta`** (-0.5 to 0.5, default 0) changes the pace. Negative is faster. It is a condition
  the model was trained on rather than a ratio, so it is not named `speed`, and the OpenAI shim's
  `speed` is refused here rather than approximated. On an 8.08 s line, -0.5 gave 5.92 s and 0.5 gave
  10.08 s.
- **`temperature`** (0 to 1, default 0.3) changes the take rather than the pace.

Numbers, currency, symbols, email addresses and URLs are spelled out before speaking, so `$5` is read
as "5 dollars". Times and numeric dates are read as written. Markdown marks may be read aloud, so give
it the text you want spoken.

## What it does not promise

**A seed nearly holds a take still, and does not reproduce it.** Repeats with one seed differ by under
1e-6 in a sample, and that is enough to flip a rounding: 9 of 20 repeats of one line were the same 16-bit
PCM. `rhapsode-conform` skips the check, as § 6 allows, and with it the comparisons that depend on it.

**Long text has joints.** A request may carry 4,096 characters, and the runtime splits it into sentences
itself, so prosody does not carry across the whole text.

## Licences

The runtime is MIT or Apache-2.0, this package is MIT, and the 31M weights, tokenizer and voices are
Apache-2.0, so all of it is commercially usable. Upstream asks that it not be used to impersonate a real
person, to deceive listeners about who is speaking, or to clone a voice without consent.

Gradium's 40M builds, which add French, German, Spanish and Portuguese, are CC BY-NC 4.0 and gated. They
are not in this engine, because a licence here belongs to an engine rather than to a variant.

## What it costs

Measured on an M5 Pro with 18 cores, on the CPU, November 2026, for an 8 s line, median of five:

| Threads | Speed |
| --- | --- |
| 1 | 57.6x realtime |
| 2 | 66.7x |
| **4** | **75.0x** |
| 8 | 62.8x |
| 18 | 50.5x |

The runtime defaults to every core, which is the slowest of these, so the adapter uses 4. It loads in
0.1 s with all its voices. Its peak was about 400 MB, speaking a 4,096-character request: 225 s of audio
in 2.7 s, with the first of it out in 11 ms. [Ollama's figures](https://ollama.com/blog/speech-models) put this
runtime at 84x on the CPU and 38x on Metal on an M5 Max, which is why this adapter stays on the CPU even
where Metal is available.

## Why not through Ollama

Ollama serves the same model over the same OpenAI route, and rhapsode could have proxied it. Ollama's
Phonon packages need Apple Silicon for now, so that route would not have run on Linux or in the Docker
image, and it would have put a second server with its own residency underneath this one's.

## Tests

The tests stub the runtime and the download, so they need neither. `rhapsode-conform` against a real
install is where the weights themselves get asked.
