---
---

An install now records the weights licence it accepted as `accepted` in its entry of `rhapsode.engines.json`, so that a reinstall knows whether somebody already accepted the terms the catalog now names. An install and an uninstall also clear `<venvDir>/<engine>.alt`, the slot a reinstall builds in. Nothing about a box that has installed engines changes until one is reinstalled. `protocol.md` § 10.
