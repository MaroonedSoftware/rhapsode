---
---

An idle model's keep-alive now unloads it and keeps the worker, instead of terminating the worker. With the SDK collecting after every unload, an unload leaves only the worker's CUDA context, about 300 MiB, so the next request reloads in seconds (1.4 s for Breeze, 4 s for Chatterbox, 13 s for Orpheus `full`) rather than starting a worker as well. Eviction still terminates, and so does `POST /engines/{engine}/unload` and `pnpm wizard unload` by default. The `--keep-process` help and the API docs now describe what an unload keeps as that context, not "roughly 30% of the card", which was uncollected reference cycles.
