---
---

`GET /update` now carries `upgrade`, the exact steps for this box when a release is out: what `RHAPSODE_VERSION` has to become, if anything, and the commands to run after it, leaving out the engine reinstall when `update.reinstallOutdated` does it. `compose.yaml` passes the server the image it named as `RHAPSODE_IMAGE`, which is what the core works them out from. The page's banner and `pnpm wizard update` show them. A `compose.yaml` from before this release passes nothing and gets the general instructions as before.
