---
title: Quick start
description: Run rhapsode in Docker, install an engine, and make it speak.
---

# Quick start

Docker is the whole install. There is nothing to clone and no Node or Python to set up.

## 1. Start it

```bash
mkdir rhapsode && cd rhapsode
curl -fsSLO https://raw.githubusercontent.com/MaroonedSoftware/rhapsode/main/compose.yaml
docker compose up -d
```

The API answers on `http://127.0.0.1:8080` and the web page on `http://localhost:8081`. Both are
published on this machine only, and [why that matters](operating.md#installing-from-the-page) is
worth reading before you widen either. Engines and their weights live in a volume, so they outlive
the container.

With an NVIDIA card and its container toolkit, start it with the GPU overlay instead:

```bash
curl -fsSLO https://raw.githubusercontent.com/MaroonedSoftware/rhapsode/main/compose.gpu.yaml
docker compose -f compose.yaml -f compose.gpu.yaml up -d
```

## 2. Install an engine

Open `http://localhost:8081`, find Kokoro on the Engines page, and install it. The page shows both
of its licences first, builds the engine a virtualenv of its own, and downloads the `fp16` weights,
about 200 MB, so the first line does not wait on them. Kokoro runs on the CPU, so any machine will
do.

The page is a client of the API and nothing more, so the same install is one request through it:

```bash
curl -X POST 'http://localhost:8081/api/engines/kokoro/install?pull=fp16'
```

It answers with a job, which `GET /api/installs/{job}` on the same port follows. Installing is a
management route: it runs pip, so it answers this machine and nobody else. Through Docker that means
through the page's port, which presents the management token for you. [§
10](protocol.md#who-may-call-them) has the rules.

## 3. Make it speak

```bash
curl -X POST localhost:8080/speak \
  -H 'content-type: application/json' \
  -d '{"engine":"kokoro","text":"Right, that was The Verve Pipe.","format":"wav"}' \
  --output line.wav
```

Or open **Try it** on the page, which offers only what the engine's capability document says it can
do.

## 4. Ask what it can do

```bash
curl localhost:8080/engines/kokoro/capabilities
```

That document is how every client decides what to offer. It says which cues, deliveries and dials
the loaded build performs, which voices it can make and how, and both licences. [The
protocol](protocol.md#4-the-capability-document) explains every field.

## Where next

- **A GPU engine.** Chatterbox clones a voice from a few seconds of audio and performs cues such as
  `[laugh]`. Orpheus streams while it generates. Dia speaks two people in one take. The
  [engines](engines/index.md) page compares them.
- **An OpenAI client.** Point its base URL at `http://localhost:8080/v1`: [OpenAI
  clients](openai.md).
- **Running it for real.** Upgrades, GPUs, unraid, settings, logs and what to watch are in [running
  one](operating.md).
- **From a checkout.** `pnpm install && pnpm wizard setup && pnpm dev` builds everything and runs
  the server from source. [Contributing](develop/contributing.md) has the rest.
