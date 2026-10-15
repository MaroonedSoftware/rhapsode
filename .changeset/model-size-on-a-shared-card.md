---
---

A model loaded onto a GPU shared with other programs now reports its size. When another process freed memory during the load, the card-wide measurement came out at zero or less and the size was left out, so the web page showed "—". The worker now also reads its own torch allocator across the load and reports that figure when the card-wide one is smaller.
