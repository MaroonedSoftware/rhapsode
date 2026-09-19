---
---

`@rhapsode/core`: `/speak` with `stream: false` now reads the worker's whole answer before sending a status, as protocol § 6 says. A body too small to be audio is a `500` envelope with code `internal` instead of an aborted connection, and the response carries `Content-Length` and `X-Rhapsode-Duration-Ms`, which the core used to drop. `stream: true` is unchanged.
