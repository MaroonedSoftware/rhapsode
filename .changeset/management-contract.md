---
'@rhapsode/contract': minor
'@rhapsode/core': minor
---

The contract declares the engine management API from protocol.md § 10: `CatalogEntry`, `InstallJob`, `PullRequest` and `FeedEvent`, and the `/catalog`, `/engines/{engine}` (delete), `/engines/{engine}/install`, `/engines/{engine}/pull` and `/installs` operations. The error taxonomy gains `forbidden` (403) and `conflict` (409) at the end. No route answers yet.
