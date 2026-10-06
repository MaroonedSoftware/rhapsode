---
---

Breeze TTS 2 is in the catalog: BreezeBlue's 3B model, which ranked first among open weights on the Artificial Analysis speech arena at its release. It speaks English and Chinese, performs all eight cues in both, streams as it generates, and clones from a clip and its `transcript`. Its code is Apache-2.0 and **its weights are for research and non-commercial use only**, so an install has to accept `BreezeBlue-Research-Non-Commercial`. It needs an NVIDIA card with about 8 GB free. `rhapsode-engine-breeze` is the new adapter package, and `rhapsode-vendor-breeze` carries upstream's inference code, which has no packaging of its own; a catalog record can now name such companions, installed in the same resolve as its adapter.
