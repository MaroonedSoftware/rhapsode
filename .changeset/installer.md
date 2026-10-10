---
---

A new installer: `curl -fsSL https://github.com/maroonedsoftware/rhapsode/releases/latest/download/install.sh | sh` sets up an install in `./rhapsode`, with `compose.gpu.yaml` merged when Docker can reach an NVIDIA card, and running it again in that directory upgrades it, compose files included. Every release now carries the installer, `compose.yaml`, `compose.gpu.yaml`, the new `compose.lan.yaml` (both ports on every interface) and `env.example` as assets.
