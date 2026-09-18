---
'@rhapsode/contract': minor
'@rhapsode/core': minor
---

`POST /engines/{engine}/pull` queues a job that downloads a variant's weights through the worker's new `POST /fetch`, without loading anything, so a first `/speak` does not sit through the download. The worker SDK gains an optional `Engine.fetch(variant)`, which answers `unsupported` unless an adapter overrides it; `rhapsode-engine-chatterbox` implements it with the same repositories and files its loads read. The conformance suite checks that `/fetch` either succeeds without loading or says `unsupported`.
