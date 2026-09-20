---
---

`GET /engines` and `GET /health` now carry `workerVersion` for each engine: the version of
`rhapsode-worker` installed in that engine's virtualenv. `protocol.md` § 9 pins an engine to the
core's version when it is installed, and an upgrade is the one thing that breaks that pin, because
the virtualenvs live on the volume an upgrade deliberately keeps. Nothing said so. Negotiation
refuses a worker whose contract is too new and is silent about one that is too old, and every field
added inside a contract major since that worker was built is simply one it never sends: a box
upgraded from 0.1.3 to 0.1.6 went on speaking through a 0.1.2 worker and only stopped reporting
`sizeBytes`, which reads as a card that cannot be measured rather than as an engine to reinstall.

It is read from the virtualenv rather than asked of the worker, so an engine that is `down` still
answers, which is an engine's ordinary state now that a model leaves the card when nothing is using
it. It is a diagnostic and never an input to negotiation: nothing branches on it, and a client still
reads `contract` to decide what it may send. It is absent, rather than guessed, for a remote engine
and for any virtualenv whose metadata cannot be read.
