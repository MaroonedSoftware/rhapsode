---
---

A worker that exits before its handshake is now `internal` (500, not retryable) rather than `model_unavailable` (503, retryable), and so is an engine whose interpreter does not exist: neither will start on the next attempt, and a client trusting `retryable` would have retried them forever. Breeze TTS 2 on a Mac, which exits naming the NVIDIA card it needs, was the case that showed it. A worker killed by a signal before its handshake is still `model_unavailable`.
