---
---

`GET /update` says whether a newer release of rhapsode exists. The core asks GitHub for the latest release at most once a day, only when something asks, and never makes the caller wait: the first answer after boot is `check: pending`. It sends a `User-Agent` naming rhapsode and its version and nothing else, and `update.check: false` in the config or `RHAPSODE_UPDATE_CHECK=0` in the environment turns it off. The image sets `RHAPSODE_DISTRIBUTION=docker`, which the answer reports so a client knows to show `docker compose pull`. `protocol.md` § 9.
