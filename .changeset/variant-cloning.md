---
---

Each entry in a capability document's `variants` now says whether it clones, as `cloning`, the same shape `current` carries. Cloning needs no loaded model, so a client can now tell an engine that cannot clone from one that is idle. The field is optional, since contract 1 shipped without it, and the conformance suite checks that it matches what `POST /voices` actually does.
