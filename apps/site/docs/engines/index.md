---
title: Engines
description: Which engine to install, what each one needs, and how their licences work.
---

# Engines

An engine is a Python package that the server installs into a virtualenv of its own, through the
API, the web page or `pnpm wizard install`. One engine's dependencies cannot break another's, and a
crash takes down that engine's worker rather than the server.

## Which one

- **Start with [Kokoro](kokoro.md).** It runs on the CPU with no torch, its weights are about 200
  MB, and it speaks faster than realtime on a laptop. It performs no cues, and makes new voices by
  blending its own rather than by cloning.
- **With a GPU, [Chatterbox](chatterbox.md).** It clones a voice from a few seconds of audio. Its
  `turbo` and `nano` builds perform all eight cues; its `original` and `multilingual` builds take
  dials instead. Which you get depends on the build that is loaded, and the capability document says
  which.
- **For audio that starts before the line is finished, [Orpheus](orpheus.md).** It streams while it
  generates, and performs seven of the eight cues. On Linux it runs the `full` build through vLLM on
  an NVIDIA card; elsewhere the `q8` and `q4` builds run through llama.cpp.
- **For two people talking, [Dia](dia.md).** It speaks a two-speaker dialogue in one take, performs
  all eight cues, and clones from a clip and the words spoken in it. It wants a real GPU: on a Mac
  it runs at about a tenth of realtime.
- **[Tone](tone.md)** makes a sine wave. It exists to prove the protocol in CI, and it is the
  fixture the conformance suite compares a real engine against.

## Licences

Every engine carries two licences, one for its code and one for its weights, and the catalog shows
both before anything is installed. An engine whose weights may not be used commercially installs
only once that licence is accepted by name. The core is MIT; each engine is a separate package under
its own licences, so an engine with restrictive weights can sit in the catalog without touching the
core.

## Adding one

An engine is one Python class. See [adding an engine](../develop/index.md).
