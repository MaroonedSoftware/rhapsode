---
---

Dia is in the catalog: Nari Labs' 1.6B model through transformers, performing all eight cues, with `cfgScale`, `temperature` and `topP` dials. It has no voices of its own, so a request naming none is read in the voice the model picks, which a `seed` fixes and which a long text keeps from its first piece to its last. It clones from a clip and its `transcript`. Its code and weights are Apache-2.0, 6.7 GB with its codec, and it wants an NVIDIA card: on a Mac it runs at about a tenth of real time. `rhapsode-engine-dia` is the new adapter package.
