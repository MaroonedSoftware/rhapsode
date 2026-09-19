---
---

The core serves its public API as OpenAPI 3.1 at `GET /openapi.json`, open to every caller like `/health`, with `info.version` set to the running core's version. The client SDK gains `openapi()` to read it. Worker routes are never in it.
