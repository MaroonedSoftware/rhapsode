---
---

`rhapsode-engine-chatterbox` now loads on Apple Silicon: the device reaches upstream as a string, which is what upstream checks before mapping a CUDA-saved checkpoint onto the CPU. It also pins `setuptools<81`, without which upstream's watermarker import fails silently and every build fails to load on a fresh install.
