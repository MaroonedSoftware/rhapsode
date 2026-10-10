---
---

The server image is published to Docker Hub as `maroonedsoftware/rhapsode`, and no longer to `ghcr.io/maroonedsoftware/rhapsode`, which stays at 0.1.23. An existing install must download `compose.yaml` again, or change its `image:` to `maroonedsoftware/rhapsode`, before `docker compose pull` will find this release.
