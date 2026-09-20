---
---

Cloning a voice takes an optional `transcript`, the words spoken in the reference clip, for an engine that clones by continuing from the clip. Such an engine refuses a create without one as `bad_request`, naming the field, and every other engine ignores it. The web page's clone form has a Transcript field, `CreateVoiceRequest.transcript` carries it to an adapter, and the conformance suite sends one with every clone.
