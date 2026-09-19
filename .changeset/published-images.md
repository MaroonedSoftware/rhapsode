---
---

`docker compose up` pulls `ghcr.io/maroonedsoftware/rhapsode-server` and `rhapsode-web` rather than building them, and `RHAPSODE_VERSION` pins a release. Both images are published for amd64 and arm64 with every release, at the version every package carries. To build from a checkout, as before: `docker compose -f compose.yaml -f compose.build.yaml up -d --build`.
