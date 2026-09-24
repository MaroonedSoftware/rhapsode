---
title: Adding an engine
description: One Python class, one conformance suite, and one line in the catalog.
---

# Adding an engine

An engine is a Python package that subclasses one class. You write Python and never open a
TypeScript file. The SDK, [`rhapsode-worker`](worker-sdk.md), binds the socket, answers the
handshake, maps errors, encodes whatever format a client asked for from your native PCM, retries a
load that ran out of memory, and splits text too long for one generation.

## 1. Write the class

Subclass `Engine`, say which builds you have and what each one performs, and implement `load`,
`unload`, `voices` and `speak`. `speak` yields PCM; the SDK turns it into wav, mp3, opus or flac. [§
8 of the protocol](../protocol.md#8-the-python-worker-sdk) walks through a whole adapter, and
[Tone](https://github.com/MaroonedSoftware/rhapsode/tree/main/python/rhapsode-engine-tone) is the
smallest real one.

## 2. Claim only what you perform

It is the one thing an adapter must do honestly, and nothing else checks it. The core strips every
cue the loaded build does not claim before your engine sees the line, and refuses a dial you did not
declare, so a claim you make is a promise to every client that reads your capability document. If
your builds differ, declare them as separate variants: that is what [the capability
document](../protocol.md#4-the-capability-document) is shaped for.

## 3. Run it on its own

A worker speaks the engine-scoped part of the public API, so you can start it alone and talk to it
with curl. The core is not a dependency of writing an adapter.

## 4. Run the conformance suite

```bash
rhapsode-conform unix:/run/rhapsode/workers/your-engine.sock
```

It says whether your worker is one. Each check names the section of the protocol it comes from, and
the exit code is the verdict for your own CI. Some checks compare audio with and without a cue, with
the seed held fixed, which is as close as a machine can get to checking step 2.
[Conformance](conformance.md) explains what it can and cannot decide.

## 5. Put it in the catalog

The catalog is the list of engines the server knows how to install, with both licences. Adding yours
is a pull request: open an [engine
issue](https://github.com/MaroonedSoftware/rhapsode/issues/new?template=engine.yml) first, then
follow [contributing](contributing.md).
