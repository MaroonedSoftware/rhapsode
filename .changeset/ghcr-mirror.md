---
---

The server image is mirrored to `ghcr.io/maroonedsoftware/rhapsode` again, beside Docker Hub, so an install whose `compose.yaml` predates the move keeps finding new releases with `docker compose pull`. 0.1.24 was published to Docker Hub only, so such an install goes from 0.1.23 to this release.
