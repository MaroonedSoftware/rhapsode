---
---

An install that pulls a variant whose first load compiles now does that load itself, so the first request does not. A variant declares it with `compiles` in its capability document (`Variant(compiles=True)` in the SDK), and Orpheus's `full` does: vLLM compiling the graph made its first load 35 s and 8.05 GB held, against 12 s and 7.26 GB after. `POST /engines/orpheus/install?pull=full` gains a sixth step, `warm`, which loads it through residency and unloads it again, and a reinstall warms it again after the swap, since an upgrade of vLLM or torch moves the compile cache. A pull still loads nothing. In the server image the cache is on the `/data` volume, so it survives the container being recreated.
