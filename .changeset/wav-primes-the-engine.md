---
---

`rhapsode-worker`: a streamed `wav` whose engine fails before its first chunk, such as on an unknown voice, now answers with the error's status instead of a `200` and an aborted connection. The SDK primed the encoded stream, and a WAV's header comes out before the engine is asked for anything.
