---
---

`rhapsode-engine-orpheus` is a new engine, and in the catalog: Orpheus (Canopy Labs' Llama 3.2 3B finetune) through llama.cpp, in `q8` and `q4` builds that run on Metal, CUDA or the CPU. It performs seven of the eight standard cues (not `clear throat`, which it has no tag for), speaks in the finetune's eight voices, and streams audio as each frame decodes instead of chunking a finished waveform. `docs/protocol.md` § 5 now says an adapter strips its engine's own tag syntax, so the standard vocabulary is the only way to reach a cue.
