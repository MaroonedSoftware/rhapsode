---
---

`rhapsode-worker`: a streamed `/speak` ends with an `X-Rhapsode-Duration-Ms` trailer, declared up front in a `Trailer` header, as protocol § 6 says. uvicorn cannot send trailers, so the SDK now serves on uvicorn's h11 implementation (never httptools, even where it is installed) and adds them itself. A request over HTTP/1.0, or a worker run under another server, gets the same response without the trailer.
