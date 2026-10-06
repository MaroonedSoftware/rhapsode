---
---

Orpheus's `full` build loads on the first try. On a cold compile cache vLLM counted compiling the graph as activation memory, left nothing of its 7 GiB for the KV cache, and failed "No available memory for the cache blocks" until the SDK's retry came up on the cache that failure had filled: 50 s instead of 35. The engine now gives vLLM an explicit KV cache of one 2048-token sequence (0.22 GiB) instead of whatever profiling left, which also holds 0.44 GB less on every warm load. An operator's `RHAPSODE_ORPHEUS_GPU_MEMORY` still hands the sizing back to vLLM. Needs vLLM 0.10.2 or later.
