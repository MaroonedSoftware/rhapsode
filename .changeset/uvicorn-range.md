---
---

`rhapsode-worker` now requires `uvicorn>=0.33,<0.54`, where it accepted anything from 0.30 below 1.0. The streamed duration trailer is written through uvicorn internals that can change in any pre-1.0 minor release, so each new minor is a deliberate upgrade, made after the worker suite passes on it. The floor is where the SDK stops a synthesis when the client hangs up: on 0.30 to 0.32 the engine ran on after the client had gone.
