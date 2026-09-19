---
'rhapsode': minor
---

The Docker image serves the web page itself, so `docker compose up` runs one container instead of two. nginx runs beside the server in the same container, proxying `/api` to it over loopback and presenting the management token, and both ports are still published on 127.0.0.1 only. On unraid that is one container with ports 8080 and 8081, with no network to create and no `RHAPSODE_UPSTREAM`. Coming from the two-container compose, run `docker compose up -d --remove-orphans`, because the old page container still holds port 8081.
