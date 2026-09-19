---
'rhapsode': minor
---

There is no `web` image: `docker/Dockerfile` builds only the server, which serves the page itself. The server no longer writes `/config/management.token` for a page container to read, and removes one left by an earlier version, so the token is kept only in `rhapsode.config.json`.
