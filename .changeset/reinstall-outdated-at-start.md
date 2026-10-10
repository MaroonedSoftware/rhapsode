---
---

A new setting, `update.reinstallOutdated`, has the server reinstall every engine an upgrade left behind each time it starts, as `POST /installs/outdated` would, so an upgrade needs nothing after `docker compose pull` and `docker compose up -d`. It is off by default. The Docker image turns it on in the config it writes on first boot; an existing box turns it on under Settings, Updates, or with `pnpm wizard settings update.reinstallOutdated true`.
