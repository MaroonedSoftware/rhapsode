---
---

`pnpm wizard reinstall <engine>` and `pnpm wizard reinstall --all` rebuild engines an upgrade left behind, through the running server, asking for a weights licence only when the server says it has to be accepted again. `pnpm wizard update` says whether a newer rhapsode is out and which engines are behind, gives the commands for the first, and offers the reinstall for the second; `--exit-code` changes nothing and exits 2 when anything is behind. The doctor's freshness check now points at `reinstall --all` rather than an uninstall.
