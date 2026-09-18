---
'@rhapsode/sdk': minor
---

`@rhapsode/sdk`, a typed client for the public API generated from `contracts/` by ContractKit and committed. It has no dependencies. `new RhapsodeSdk({ baseUrl }).public` has a method per operation; a declared error status comes back as a value with the protocol's envelope, and an undeclared one throws `SdkError`. Read a job's event stream with an `EventSource` rather than `installJobEvents`, which cannot return while the stream is open.
