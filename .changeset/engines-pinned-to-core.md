---
---

`@rhapsode/core`: an engine installed by name from the package index is now pinned to the core's own version, `rhapsode-engine-kokoro==<core version>` together with `rhapsode-worker==<core version>`, as protocol § 9 now says every package releases at one version. An install from `install.sourceDir`, which is how a checkout and the server image work, is unchanged. Each engine pins `rhapsode-worker` to its own version exactly, and a test holds every engine, the worker SDK and the core to one number.
