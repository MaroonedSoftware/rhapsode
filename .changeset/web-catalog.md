---
'@rhapsode/web': minor
---

`apps/web`, a web page for installing engines, starts as a read-only catalog: every engine rhapsode knows about, with the licence for its code and, separately, for its weights, and which of them this box has. `pnpm --filter @rhapsode/web dev` serves it on port 8081 and proxies `/api` to a core on 8080.
