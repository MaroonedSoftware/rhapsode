---
---

`pnpm wizard update` asks the server to check GitHub now, through `POST /update/check`, rather than reading an answer that may be a day old, so it reports a release published minutes ago.
