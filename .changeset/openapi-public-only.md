---
---

`docs/openapi.yaml` describes the public API alone, and at the release version rather than `1.0.0`. It used to merge in the worker protocol, whose `/health` and `/speak` replaced the public ones: the document described a `/speak` that takes no `engine`. The worker protocol has its own document, `docs/openapi.worker.yaml`.
