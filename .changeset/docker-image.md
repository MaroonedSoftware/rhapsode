---
'rhapsode': minor
---

rhapsode runs in Docker. `docker compose up` builds and starts the server and the web page, keeping the config, its management token and cloned voices in a `/config` volume and every installed engine, the Python it runs on and its weights in a `/data` volume, so an install survives the image being rebuilt. The image has no Python of its own, so that a base image upgrade cannot break the virtualenvs in `/data`. The page's container presents the management token for it, which is why both ports are published on 127.0.0.1 only. It runs under any uid, including unraid's 99:100, and docs/operating.md § Docker has what it keeps where.
