---
---

`GET /residency` lists what is on the card: engine, variant, how many requests are still speaking
it, when it was last used, when it expires, the keep-alive actually in force and what the worker
measured it taking (`protocol.md` § 3). `/health` only ever gave counts, so an operator whose card
was full could see that one model was resident and nothing about which, how large, or when it would
go. `expiresAt` is absent while a model is speaking, because the deadline starts when the last
request lets go, and absent when its keep-alive says never. Like `/health` and `/engines` it reads
the core's own state: it starts no worker and waits on none, since listing what is loaded should not
be a reason to load anything. It is deliberately not a route to call before speaking, as `/speak`
loads on demand and § 3 spends a rule on why a client should not ask first. The client SDK gains
`residency()` from the same contract.
