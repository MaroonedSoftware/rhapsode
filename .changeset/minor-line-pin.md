---
---

`compose.yaml` now pulls the image's minor line (`0.1`) by default rather than `latest`, so `docker compose pull` takes every patch release and stops at the next minor. A new `.env.example` holds the settings of an install, `COMPOSE_FILE` and `RHAPSODE_VERSION` among them, so that a newer `compose.yaml` can be downloaded over the old one without losing them.
