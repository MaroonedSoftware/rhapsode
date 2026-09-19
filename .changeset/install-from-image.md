---
'rhapsode': minor
---

Installing with Docker needs no checkout: `compose.yaml` pulls `ghcr.io/maroonedsoftware/rhapsode`, so downloading it and running `docker compose up -d` is the whole install, and `RHAPSODE_VERSION` picks the tag (`latest` by default). Building from a checkout moves to `compose.build.yaml`: `docker compose -f compose.yaml -f compose.build.yaml up -d --build`. unraid runs the published image rather than one built on the box.
