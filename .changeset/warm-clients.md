---
---

`GET /catalog` says which variants an engine this API installed has warmed, as `warmed`. `pnpm wizard warm <engine> [variant]` warms a variant that compiles on its first load; without a variant it warms every one the engine says compiles that has not been warmed. `pnpm wizard update` and `pnpm wizard reinstall` offer the same for the engines they have just reinstalled, which is what an Orpheus installed before installs warmed needs after an upgrade: its reinstall rebuilds it, but its first request would still compile, 35 s against 12.
