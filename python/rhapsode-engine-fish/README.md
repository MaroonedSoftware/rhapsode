# rhapsode-engine-fish

Fish Audio S2 Pro as a rhapsode engine.

S2 Pro is Fish Audio's dual-autoregressive model, released in March 2026: 4B parameters along time
and 400M across its codec's ten codebooks, trained on more than 10M hours in 80-odd languages. It is
the second-ranked open-weight model on the Artificial Analysis speech arena, and the most expressive:
its tags are free-form directions in brackets rather than a fixed list.

**Its weights and its code are for research and non-commercial use only**, under the Fish Audio
Research License. Commercial use needs a licence from Fish Audio, and distributing it, or a product
that uses it, requires the agreement, a notice, and "Built with Fish Audio". An install has to accept
it by name (protocol.md § 10).

## Where upstream's code comes from

The worker runs `fish-speech`, Fish Audio's own inference code, and rhapsode ships none of it. Its
pyproject cannot be installed here: it depends on `pyaudio`, which needs PortAudio's headers and a
compiler that the server image does not have, though nothing that runs inference imports it. And
its licence is the weights' licence, so a copy in a rhapsode package would be rhapsode distributing
it. So a pull, or the first load, downloads upstream's archive at a pinned commit, keeps
`fish_speech/` and its licence, and checks the unpacked files against a pinned digest, into
`~/.cache/rhapsode/fish-speech/<commit>`, or wherever `RHAPSODE_FISH_SOURCE` points. This package
depends on what that code imports, and on nothing it does not.

## What it can do

- **Cues:** `laugh`, `chuckle`, `sigh` and `clear throat`, the four the card's list of common tags
  covers: `[laugh]` becomes `[laughing]`. Every other bracket a client writes is removed, prose
  included, because this model performs any bracketed description rather than reading it.
- **Deliveries:** none yet. `[whisper]` is on the card's list and is how `hushed` would be
  performed, once it is heard to hold for a whole line.
- **Dials:** `temperature`, `topP` and `repetitionPenalty`, upstream's own bounds and defaults, 0.8,
  0.8 and 1.1. No `speed`.
- **Voices:** none of its own. A request that names none is read in whichever voice the model picks,
  which a `seed` fixes. Cloning takes a clip and its exact `transcript`, 5 to 10 seconds of it and at
  most 20.
- **Variants:** `s2-pro`. 9.1 GB of model and 1.9 GB of codec, fetched from a pinned revision, with
  upstream's code, by a pull ahead of the first load or by that load.
- **Languages:** the card's first two tiers: English, Chinese, Japanese, Korean, Spanish,
  Portuguese, Arabic, Russian, French and German.
- **Devices:** CUDA, Metal or the CPU, as upstream's own server allows. bfloat16 on a card, float32
  on the CPU, where a 4.4B model will be slow.

## How it reads a long text

Upstream batches a text only where it finds speaker tags, so an untagged text would be one generation
however long. The adapter cuts it where a reader would pause, into pieces of 187 characters, which
with the 13-byte speaker tag each carries is upstream's 200-byte batch, and tags each as the first
speaker. Upstream then reads the pieces as turns of one conversation, each carrying the audio of
every turn before it, so one voice holds from the first piece to the last. Each batch's audio is
passed on as it is decoded.

Upstream's model thread does not wait for the decoder, so a request that is abandoned keeps the model
busy until its last batch is generated.

## Memory

Measured on an RTX 4070 Ti SUPER: the model is 9.56 GiB in bfloat16, 4.56B parameters. Upstream then
sets up a key/value cache for the checkpoint's whole 32,768-position context, 4.8 GB, which with the
codec is why it asks for a 24 GB card. This adapter runs the model thread itself and sets the context
to 12,288, where the cache measured 1.69 GiB. That still holds the longest request: 4,096 characters
is about 4.5 minutes of audio, under 8,000 positions with its text and a 20 s reference.

Two more things upstream sizes for 24 GB, and the adapter does not:

- **The causal mask** is built at the checkpoint's length when the model is, 32,768 squared booleans,
  1 GiB, the largest buffer on the card. Nothing indexes it past the context, so it is cut to 144 MiB.
- **The codec** is loaded on the CPU and moved, because upstream's loader reads all of `codec.pth`
  onto the device before keeping the half it uses. Loaded on the card beside the model, it went past
  14 GiB and ran out.

Whether the whole of it fits a 16 GB card while speaking has not been measured yet.
