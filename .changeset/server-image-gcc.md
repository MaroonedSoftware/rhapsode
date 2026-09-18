---
---

The server image carries `gcc` and `libc6-dev`, 182 MB, because Triton under vLLM compiles a small C helper at run time, and Orpheus's `full` build failed every load in the image without a C compiler. It is C only: there is still no C++ compiler and no CUDA toolkit in the image.
