# phonon-40m

Gradium's [Phonon 40M](https://huggingface.co/gradium/phonon-40m-multilingual) builds as a rhapsode
engine, in English, French, German, Spanish and Portuguese. It is the same adapter and runtime as
[`phonon`](README.md), with the same dials, no cues and no cloning, on the CPU with no torch.

**Its weights are CC BY-NC 4.0: non-commercial use only.** For commercial use, `phonon` is Apache-2.0
and speaks English.

> **Run on real weights in `de` only.** `de` passes `rhapsode-conform` on its real weights and speaks
> through the OpenAI shim. The other five builds, `multilingual` among them, use the same adapter and
> layout and have only run against a stubbed runtime, so choosing a language per request is unproven on
> real multilingual weights.

## Installing it

The weights are gated, so there are two steps before the first download:

1. Accept the terms on the Hugging Face page of each build you want. Approval is automatic, and each
   repository asks separately:
   [multilingual](https://huggingface.co/gradium/phonon-40m-multilingual),
   [en](https://huggingface.co/gradium/phonon-40m-en), [fr](https://huggingface.co/gradium/phonon-40m-fr),
   [de](https://huggingface.co/gradium/phonon-40m-de), [es](https://huggingface.co/gradium/phonon-40m-es),
   [pt](https://huggingface.co/gradium/phonon-40m-pt).
2. Log in as the user the server runs as, with `hf auth login`. In the container, write the token to
   `~/.cache/huggingface/token`; [`docs/operating.md`](../../docs/operating.md) has the command.

Do not put `HF_TOKEN` in this engine's `env` block in the config file. Naming an engine there makes it
the operator's, and the install is then refused.

```bash
pnpm wizard install phonon-40m
```

The wizard and the web page show both licences and ask. Through the API, the install names the licence
it accepts: `POST /engines/phonon-40m/install?accept=CC-BY-NC-4.0&pull=de`. Without the login the install
succeeds and its pull fails, saying which page to visit.

## Which build

Six variants, one model each:

| Variant | Speaks | Voices | Download |
| --- | --- | --- | --- |
| `multilingual` (default) | All five | 103 | about 100 MB |
| `en` | English | 38 | about 85 MB |
| `fr` | French | 16 | about 79 MB |
| `de` | German | 14 | about 78 MB |
| `es` | Spanish | 26 | about 82 MB |
| `pt` | Portuguese | 13 | about 78 MB |

A build for one language reads it better. On [Gradium's own listening tests](https://huggingface.co/gradium/phonon-40m-multilingual)
`de` scored 2097 Elo in German and `multilingual` 2046.

`multilingual` reads `language` from the request, and keeps one model in memory for all five. Set it to
match the text, because it decides how numbers and symbols are spelled out, and `$5` read as English in
a German sentence is the kind of mistake nothing reports. With no `language` it reads English, the first
it lists, whichever voice was asked for. A voice from another language may read any of them, though
upstream advises matching them.

## Through the OpenAI shim

`model` takes `engine:variant`, so a client that can only be given a base URL and a model name can have
German:

```bash
curl localhost:8080/v1/audio/speech -H 'Content-Type: application/json' \
  -d '{"model":"phonon-40m:de","input":"Guten Abend.","voice":"Nele","response_format":"wav"}' -o speech.wav
```

The shim cannot pass `language`, so `phonon-40m` alone speaks English. Name a build for the language.

## What it costs

Measured on `de`, on an M5 Pro's CPU, November 2026, median of five for an 8 s line: 60x realtime, with
the first audio out in 14 ms. It loads in 0.1 s. A 4,096-character request was 220 s of audio in 3.3 s,
with the first of it out in 17 ms and a peak of 412 MB. `durationDelta` moves that 8.16 s line between
5.84 s and 9.36 s across its range, and stops doing anything past it, as on `phonon`.

Upstream's figures for 40M, on a MacBook Air M5's CPU: 20x realtime on one core and 39x on four. A
Raspberry Pi 5 manages 2.2x on one core.
