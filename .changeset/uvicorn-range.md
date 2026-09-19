---
---

`rhapsode-worker` now requires `uvicorn>=0.36,<0.54`, where it accepted anything from 0.30 below 1.0. The streamed duration trailer is written through uvicorn internals that can change in any pre-1.0 minor release, so each new minor is a deliberate upgrade, made after the worker suite passes on it. The suite passed on every release from 0.36 to 0.53.
