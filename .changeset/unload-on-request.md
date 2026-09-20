---
---

`POST /engines/{engine}/unload` frees a model now rather than waiting out its keep-alive
(`protocol.md` § 3 and § 10). `?mode=terminate` is the default and ends the worker process, which is
the only way to get back the roughly 30% an unload strands; `?mode=unload` keeps the process for a
faster next load. It is behind the management guard, because somebody who can empty a card can make
every synthesis on the box pay a cold start, and it is idempotent: an engine holding nothing is
already in the state the request asks for, and a soft unload of nothing starts no worker to discover
that. A terminate still ends a process holding no model, which is how an operator reclaims what a
variant switch left behind. It is refused with `409` while the engine is speaking, for the reason an
uninstall is: cutting off a stream hands that caller a truncated file for something they could not
have predicted. The wizard and the web page get the same verb in the releases after this one.
