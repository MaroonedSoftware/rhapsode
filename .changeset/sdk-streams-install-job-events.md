---
---

The client SDK's `installJobEvents` now streams. It returns an async iterable of `FeedEvent`s, with `lastEventId` for resuming and an optional `signal`, where it used to read the whole body and never return for a job still running. A 403 or 404 is now a thrown `SdkError` rather than a returned status.
