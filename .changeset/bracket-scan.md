---
---

Text full of `[` with no `]` no longer takes quadratic time to scan for cues. The core's cue report read from every `[` to the end of the text, so 40,000 of them took 5.6 s; it now stops at the next `[`.
