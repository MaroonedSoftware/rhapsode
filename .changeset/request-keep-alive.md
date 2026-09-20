---
---

`POST /speak` and `POST /engines/{engine}/dialogue` take `keepAliveSeconds`, saying how long the
model that request loads should stay once it is done: `-1` never expires, `0` gives the card back as
the audio ends, and anything else is a deadline in seconds (`protocol.md` § 3). It is the one thing
the server cannot know and the caller often does, which is whether more is coming. Precedence is
request, then engine, then server, and the last request to take a lease wins, because two requests
sharing a model cannot both be right about how long it stays. A keep-alive is not a reservation: an
eviction under a full budget still takes a pinned model, which is what keeps § 3's load-on-demand
rule true for everybody else. The field is on the public request shapes only and is never forwarded
to a worker, since an adapter that can see a keep-alive will eventually act on one. The OpenAI shim
does not take it, as it takes none of the native fields (§ 11). The client SDK and the OpenAPI
document carry it, from the same contract.
