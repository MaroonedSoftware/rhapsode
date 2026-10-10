---
---

Fish now installs torch and torchaudio 2.11.0 rather than upstream's 2.8.0, which clears two of the
three PyTorch memory-corruption advisories against it (GHSA-vgrw-7cvw-pwgx, GHSA-qfhq-4f3w-5fph).
The third, GHSA-rrmf-rvhw-rf47, is fixed only in torch 2.13.0, and 2.11.0 is the last torchaudio
release. Cloned voices are decoded by the adapter rather than by upstream's `torchaudio.load`, which
from torchaudio 2.9 needs torchcodec and FFmpeg. Reinstall Fish to pick this up
(`pnpm wizard reinstall fish`, or `POST /installs/outdated`).
