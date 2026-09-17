# Rhapsode

**A multi-engine speech server: one contract, many TTS models.** Ollama, but for speech engines.

Point it at a box with a GPU, install the engines you want, and every client talks to one HTTP API
that describes honestly what each engine can actually do.

> **Status: early.** The worker protocol is implemented and conformance-tested, and a core that
> spawns a worker and streams `/speak` through it works end to end. What is not here yet: a real
> engine (the only one that ships is a tone generator with no weights), voice cloning through the
> core, and the OpenAI and Wyoming shims.
> [`docs/protocol.md`](docs/protocol.md) is still the specification, and it still outranks the code.

A rhapsode was a performer who recited written verse aloud. That is the job description.

## Why this exists

Self-hosted TTS in 2026 is served by three kinds of project, and none of them is a server you can
build a product on.

- **Single-model wrappers** put a web UI on one model family. Good UIs, and you are using someone's
  UI backend as infrastructure. Their generation defaults live behind a UI bootstrap endpoint; the
  request schema is discoverable only by parsing their OpenAPI document.
- **UI-first multi-model suites** support twenty engines, and their API is a tab in the UI that
  launches a second server. Per-extension virtual environments exist, but they isolate the *UI*, not
  inference, so every engine reachable through the API still shares one environment.
- **API-first servers** are well built and stop at the easy engines, the ones with no voice cloning
  and no model-residency problem.

Rhapsode is the fourth thing: headless, multi-engine, contract-first, with real process isolation
and a residency manager that knows a GPU holds one model at a time.

## How it works

**A worker speaks the engine-scoped subset of the public API.** There is no second protocol.

```
                  ┌─────────────────────────────────────────┐
  client  ───▶    │  core: routing, residency, encoding     │
                  │  never imports torch                    │
                  └───┬─────────────┬─────────────┬─────────┘
                      │             │             │   HTTP over a unix socket
                 ┌────▼────┐   ┌────▼────┐   ┌────▼────┐   (or TCP, for a remote engine)
                 │chatterbox│   │  dia   │   │ piper  │
                 │ own venv │   │own venv│   │own venv│
                 └─────────┘   └────────┘   └────────┘
```

Which buys four things:

- An engine author develops and tests against the **worker alone**, with curl. The core is not a
  dependency of writing an adapter.
- A **remote worker is a URL**, so engines on another machine need no new protocol.
- One engine's dependency tree cannot break another's, and a crash takes down a worker rather than
  the server.
- The core stays installable and releasable independently of the model landscape, which turns over
  about every six months.

## The capability document

Everything above is plumbing. This is the part nobody else has.

```http
GET /engines/chatterbox/capabilities
```

```json
{
  "contract": 1,
  "license": { "code": "MIT", "weights": "MIT", "weightsCommercialUse": true },
  "current": {
    "variant": "turbo",
    "cues": ["laugh", "sigh", "cough", "..."],
    "deliveries": [],
    "dials": {},
    "maxCharacters": 4096,
    "cloning": { "supported": true, "referenceSeconds": [5, 10] }
  },
  "variants": {
    "turbo":    { "cues": ["laugh", "..."], "deliveries": [], "dials": {} },
    "original": { "cues": [], "deliveries": ["hushed", "frantic"],
                  "dials": { "exaggeration": {}, "cfgWeight": {} } }
  }
}
```

Two things are going on, and both are load-bearing.

**Capabilities depend on which build is loaded.** Chatterbox is the proof: the `turbo` build performs
the paralinguistic tags and silently discards the expressiveness dials, while `original` and
`multilingual` are the other way round. A flat capability list cannot say that, so a client that
assumes one sends dials that vanish without a word.

**The licence names code and weights separately.** The weights licence is the one package metadata
never reveals and the one that decides whether you may ship. Apache-2.0 inference code over
research-only weights is real and common, and a scanner reports Apache-2.0 and is wrong in the way
that matters.

On top of that sits a standard vocabulary. A client asks for `[laugh]` and `hushed` in one set of
words; each adapter translates into whatever its engine has. The core strips every cue the loaded
variant does not claim before dispatch, so an engine that performs none never sees one, and the
failure where an engine reads the word "laugh" out loud cannot happen.

## Compatibility

The native API is the contract. Two shims sit over it, because adoption runs through other people's
clients:

- **OpenAI** `/v1/audio/speech`, where `model` selects the engine.
- **Wyoming**, for Home Assistant voice pipelines.

## Trying it

```bash
pnpm install && pnpm python:sync
pnpm build

cat > rhapsode.config.json <<'JSON'
{
    "server": { "port": 8080 },
    "engines": { "tone": { "venv": "./python/.venv" } }
}
JSON

node apps/server/dist/main.js
```

```bash
curl localhost:8080/engines
curl localhost:8080/engines/tone/capabilities
curl -N -X POST localhost:8080/speak \
  -H 'content-type: application/json' \
  -d '{"engine":"tone","text":"Right, that was The Verve Pipe.","format":"wav"}' \
  --output line.wav
```

The `tone` engine has no weights and makes a sine wave. It exists to prove the protocol rather than
to make speech, which is exactly what makes it useful: it loads in microseconds, needs no GPU, and
runs in CI on every commit. It is also the conformance fixture, and will stay one.

## Contributing an engine

An engine is a Python package that subclasses one class and is registered in the catalog. You write
Python and never open a TypeScript file. The SDK handles the socket, the handshake, the error
taxonomy, format encoding from your native PCM, and the load-retry rules.

```bash
rhapsode-conform unix:/run/rhapsode/workers/your-engine.sock
```

Point it at your worker and it says whether that worker is one: 23 checks, each naming the section
of the protocol it comes from, and an exit code you can wire into your own CI. Two of them compare
audio with and without a cue, which is the closest a machine can get to the one thing an adapter has
to get right by hand.

See [`docs/protocol.md`](docs/protocol.md) § 8, and
[`python/rhapsode-worker/`](python/rhapsode-worker/) for the SDK.

## Licence

MIT. Engines are separate packages under their own licences, which is deliberate: a GPL engine or one
with non-commercial weights can exist in the catalog without touching the core, and the catalog
records both licences so you can see what you are installing before you install it.
