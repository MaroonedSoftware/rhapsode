---
---

An unload now gives back memory held in reference cycles. The worker SDK runs the garbage collector after every adapter's `unload`, then empties torch's cache, because a model held in a cycle is not freed when the adapter drops it: Fish Audio S2 Pro left 3.93 GiB of its 11.97 GiB on the card after unloading, and every reload then ran out of memory. Engines must be reinstalled to pick up the new SDK.
