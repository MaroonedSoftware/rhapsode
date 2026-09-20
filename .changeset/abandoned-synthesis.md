---
---

The worker SDK waits for a synthesis whose client hung up to end before it loads, unloads or starts another. An engine that makes audio in one blocking call, as Chatterbox and Dia do, kept running that call after the client left, and a load or unload that started under it could crash the worker: with Dia on Metal it did.
