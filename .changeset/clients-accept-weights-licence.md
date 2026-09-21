---
---

The web page and `pnpm wizard install` now send the weights licence they showed as `?accept=`, so
they go on installing engines whose weights may not be used commercially now that the core requires
it. The wizard's "Install under these licences?" prompt now defaults to no for those engines, since
pressing return through a prompt is not reading it. `--yes` still accepts from a script.
