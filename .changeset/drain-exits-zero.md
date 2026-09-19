---
---

`rhapsode-worker`: a worker that is sent SIGTERM more than once exits 0 after draining, as protocol § 2 says, instead of sometimes dying of the second signal with -15. It also logs `draining` once rather than once per signal.
