---
---

Breeze installs again. Its vendored inference code had torch and transformers raised past what torchaudio and qwen-tts require exactly, so pip could not resolve it and every install failed on `ResolutionImpossible`. It is back on upstream's pins, torch 2.9.1 and transformers 4.57.3.
