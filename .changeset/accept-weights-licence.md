---
---

`POST /engines/{id}/install` now refuses to install weights that may not be used commercially unless
the request names their licence: `?accept=CC-BY-NC-4.0`, the catalog's `weights` string exactly.
Without it the refusal is `bad_request` before any job starts, and it names the licence and the query
that accepts it. An `accept` sent for commercial weights must still name their licence, so a client can
send it on every install. The web page and the wizard already showed both licences before an install,
but a script calling the route directly never saw either. `protocol.md` § 10 says why the licence is
named rather than being a flag. The route now declares its `400` answer, so the SDK returns the
refusal as a value.
