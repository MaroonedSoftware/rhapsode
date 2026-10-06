---
---

`POST /engines/{id}/warm` warms a variant that compiles on its first load for an engine no install warmed: one installed before installs warmed, one installed without `?pull`, or one the operator configured. It loads and unloads the variant through residency as an install's `warm` step does, as a job of kind `warm`, and records it so later reinstalls warm it again. Run it once on an Orpheus installed before installs warmed (`{ "variant": "full" }`), or its reinstall after an upgrade leaves the first request to compile, 35 s against 12. A variant that does not compile fails the job with `unsupported`. The web page names the new job kind.
