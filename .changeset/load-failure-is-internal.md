---
---

`rhapsode-worker`: a model load that throws a `TypeError`, `ValueError` or `KeyError` is now reported as `internal` (500) rather than `bad_request` (400). The request named a variant and nothing else, so the failure is never the caller's to fix.
