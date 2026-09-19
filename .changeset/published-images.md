---
---

`docker compose up` pulls `ghcr.io/maroonedsoftware/rhapsode` rather than building it, so downloading `compose.yaml` is the whole install, with no checkout. `RHAPSODE_VERSION` pins a release. The image is published for amd64 and arm64 with every release, at the version every package carries. To build from a checkout: `docker compose -f compose.yaml -f compose.build.yaml up -d --build`.
