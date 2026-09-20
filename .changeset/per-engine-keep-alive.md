---
---

An engine entry can carry its own `keepAliveSeconds`, overriding the server-wide one for that engine
alone (`protocol.md` § 3). The deadline trades a cold start against a held card, and a cold start is
per engine: a model that takes forty seconds to load has earned a longer stay than one that takes
two, and the server-wide setting cannot tell them apart. `-1` on an engine pins its model where the
rest of the server expires.
