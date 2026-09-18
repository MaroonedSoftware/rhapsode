---
'@rhapsode/core': patch
---

`POST /speak` passes `language` to the engine. It was dropped in the core, so a multilingual variant always spoke its first language, and a language the variant does not list was never refused as `unsupported`.
