---
---

`GET /health` now carries the core's own `version`, and every engine summary on `/engines` and `/health`, and every installed entry of `/catalog`, carries `outdated`: `true` when the `rhapsode-worker` in that engine's virtualenv is not this core's version, which is what an upgrade leaves behind. The core does the comparison so that no client has to order version strings. The catalog also carries `workerVersion` now. `protocol.md` § 9.
