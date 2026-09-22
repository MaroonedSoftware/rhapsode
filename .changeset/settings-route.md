---
---

`GET /settings` answers every setting the server has: the value the running process is using, the
layer it came from (the default, the config file, or the state database), and whether a change to it
applies at once or at the next start (`protocol.md` § 10, "Settings"). A change waiting for a restart
shows as `saved` beside the value still in use. It is a management route, reading included, because
it names directories on the box and the origins it trusts, and it never carries the management token:
`tokenSet` says whether there is one. The SDK has it as `settings()`.
