---
'@rhapsode/core': minor
---

`GET /installs/{job}/events` streams a job's progress, output lines and outcome as server-sent events, resumable with `Last-Event-ID`. The last event of a job is a `progress` with `status` `done` or `failed`; the stream stays open after it, and a client closes it.
