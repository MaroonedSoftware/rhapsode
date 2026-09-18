---
'@rhapsode/core': minor
---

`GET /catalog` lists every engine that exists, with both licences, its Python package, and whether this box has it. A management guard (`managementGuard`) admits loopback callers, or a caller presenting `management.token` as a bearer token, and refuses anyone else with `forbidden`. ServerKit's own refusals, such as a wrong content type, now answer `bad_request` rather than `internal` 500.
