---
---

`rhapsode-engine-orpheus` has a `full` build: Canopy's own unquantised weights through vLLM, installed with `pip install 'rhapsode-engine-orpheus[vllm]'`. It is listed only on a CUDA box with vLLM installed. Its weights are gated, so it needs `HF_TOKEN` in the engine's `env`. The pull downloads the 15.2 GB that inference reads, not the 56.7 GB repository. It has passed its tests against a stubbed vLLM but has not yet been run on a CUDA card. `docs/protocol.md` § 4 now says a worker lists only the variants it can load.
