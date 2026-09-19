---
---

A worker keeps its connection open after an adapter's own exception. A plain `ValueError` or similar out of an adapter still answers `internal` with a 500, and the next request on that keep-alive connection is no longer reset. A streamed `/speak` that fails after its headers still aborts the connection, as § 6 requires.
