---
'@rhapsode/core': minor
'rhapsode': minor
---

The server reads `rhapsode.engines.json` beside its config file, underneath it: where both name an engine, the operator's config wins field by field. Nothing writes the file yet; the install API that does is next. `loadSettings(configPath)` and `ManagedEngines` are exported for other composition roots.
