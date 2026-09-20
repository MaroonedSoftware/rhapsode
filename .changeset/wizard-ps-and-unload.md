---
---

`pnpm wizard ps` shows what the running server has loaded, how big each model is and when it
expires, and `pnpm wizard unload <engine>` gives that memory back now (`protocol.md` § 3). Both are
clients of the API and hold no logic of their own, which is what keeps the wizard and the web page
from drifting. `unload` terminates by default, since somebody at a terminal asking for memory back
means all of it, and `--keep-process` is the soft verb that trades the roughly 30% an unload strands
for a faster next load. A size that nothing could measure prints as a dash rather than as zero, and
a model with a request still speaking it shows what is holding it instead of a countdown that has
not started.
