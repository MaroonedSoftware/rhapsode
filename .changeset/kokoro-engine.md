---
'@rhapsode/core': minor
---

Kokoro is in the catalog: an ONNX engine that runs on the CPU with no torch, in three precisions (`fp16` by default, `fp32`, `int8`), with 28 English voices and a `speed` dial that the OpenAI shim's `speed` now reaches. Its weights are Apache-2.0; the code it runs is GPL-3.0-or-later through phonemizer and eSpeak NG, and the catalog says so. `rhapsode-engine-kokoro` is the new adapter package.
