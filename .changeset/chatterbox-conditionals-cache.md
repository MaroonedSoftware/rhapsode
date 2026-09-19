---
---

`rhapsode-engine-chatterbox` analyses a cloned voice's reference clip once per resident build and keeps the result, instead of on every request. A warm clone now costs what the stock voice does. Re-recording a voice, changing its file on disk, or loading another build analyses it again, and the 32 most recently used voices are kept, about 1.3 MB each.
