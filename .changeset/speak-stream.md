---
---

`GET /speak/stream` speaks text as a language model writes it. Open a WebSocket, send a `start` frame with `/speak`'s fields, then the text in whatever pieces it arrives in, and the server speaks each sentence once it is complete: the first on its own, so the first audio follows the first full stop rather than the last, and later ones packed together. Audio comes back as PCM in binary frames, with a `spoken` frame after each piece giving its length and duration. `flush` speaks what has arrived, finished or not, and `end` does that and closes. Every piece goes through the worker's ordinary `/speak` with all of its rules, so no engine needs anything new to take part. A web page from another origin is refused unless it is listed in `management.origins`, as at `/mcp`.
