---
---

The worker SDK has a `ReferenceCache` for whatever a cloning engine makes of a voice's reference clip, so the analysis happens once per voice rather than on every request. It keeps the most recently used voices, notices a re-recorded clip by its modification time and size, and is cleared by the adapter when a model loads or unloads. Chatterbox now keeps its conditionals in it, with no change in behaviour: on an M-series Mac, turbo spent 2.9 s on a cloned voice's first line and 1.0 s on each after, the same as its stock voice.
