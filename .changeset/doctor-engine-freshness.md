---
---

`pnpm wizard doctor` gains an "engine freshness" check: every local engine's `rhapsode-worker`
against the core's own version, naming any that an upgrade left behind and what to do about it.
Informational rather than red, for the reason `protocol.md` § 9 gives — a stale worker speaks a
contract this core still supports, so it works, and an operator is free to run an engine at a
version of their choosing. It answers the question that was previously only findable by listing
a virtualenv's `site-packages` by hand.

It reads the virtualenvs the config names rather than asking a running server, because the doctor
is for a checkout and the server may not be up. Against a container, `workerVersion` on
`GET /engines` is the same answer from the same helper.
