---
---

The first time a new version of the core starts, it copies the state database, the config file and the `voices` directory beside it into `rhapsode.backups/<time>-before-<version>/` before opening anything for writing, keeping the three newest copies. An upgrade no longer needs a `docker cp` of `/config` first.
