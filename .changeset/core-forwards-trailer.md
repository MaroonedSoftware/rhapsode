---
---

`@rhapsode/core`: a streamed `/speak` now reaches the client with the worker's `X-Rhapsode-Duration-Ms` trailer. The core already declared the `Trailer` header, but it ended the response before adding the trailer, so the value was dropped every time. As § 6 says, treat it as best effort: `fetch` cannot read trailers, and a client that needs the duration on every response should ask for `stream: false`.
