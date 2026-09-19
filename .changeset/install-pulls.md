---
---

An install can download an engine's weights in the same job: `POST /engines/chatterbox/install?pull=turbo` runs a fifth step, `weights`, once the engine is registered, so the first `/speak` does not wait on the download. A failed download leaves the engine installed, to be finished with a pull, and an engine that cannot download ahead of time succeeds and fetches on first load. The SDK's `installEngine` takes an optional `{ pull }` query. A bare `POST .../install` is unchanged.
