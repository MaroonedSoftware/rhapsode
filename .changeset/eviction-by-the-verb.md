---
---

An eviction now asks the worker to end its own process with `POST /terminate` and signals only when
that does not land, which is the order `protocol.md` § 2 and § 3 always described and the code had
backwards. The fix that matters is for a remote worker: evicting one used to destroy its connection
pool, and because the core keeps the handle, every later request to that engine failed until the
core restarted. A remote worker now gets the verb and keeps its connection, a local one gets the
verb before the signal with the same `SIGKILL` backstop as before, and a shutdown still signals
without asking. § 2 Stop gains the paragraph saying which is reached for when.
