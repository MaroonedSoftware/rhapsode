---
---

A model with nothing left to do now leaves the card after five minutes, where before it stayed until
something else needed the room. `residency.keepAliveSeconds` is the one setting for it and replaces
the `idleUnloadSeconds` and `idleTerminateSeconds` pair: two deadlines were needed when there were
two verbs to choose between, and an expiry now always terminates, because `protocol.md` § 3 measured
an unload leaving roughly 30% behind and a deadline that runs every few minutes would give a card
away 30% at a time. **This is on by default and it is a behaviour change**: set `keepAliveSeconds` to
`-1` for what this server did before. Both old names are still read when the new one is absent, with
a line in the log saying which was found, so no configuration file stops a server from starting.
Note that `null` is not `-1`: the sample in `operating.md` documented `"idleUnloadSeconds": null` to
mean off, and a null is read as "not set", so a file copied from it gets the five-minute default.
An expiry also no longer terminates a model that was picked up again while its timer was already on
its way, which was a race that could only get worse with a deadline running by default.
