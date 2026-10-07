---
---

A worker now drains and exits on its own when the core that spawned it dies. A core that crashed or was killed used to leave every local worker running with its model loaded, reparented to init, with nothing left to stop it.
