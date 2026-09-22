---
---

`PATCH /settings` changes settings without editing the config file (`protocol.md` § 10, "Settings").
It writes the state database, which wins over the file, and `null` clears a setting so the file's
value, or the default, shows through again. The residency settings, each engine's keep-alive and
`update.check` apply at once: a keep-alive changed while a model sits idle moves its deadline from
when it was last used, so a shorter one frees a model already past it. Everything else is saved for
the next start and shows as `saved` until then. A patch is one transaction, refused whole if any of
it is out of range, misspelt, or names an engine that is not installed. Two changes are refused as
`conflict` because they would lock their caller out: a caller on another machine leaving the server
with no management token, and a page leaving its own origin out of `management.origins`.
`RHAPSODE_UPDATE_CHECK=0` still turns the update check off whatever is written. The SDK has it as
`updateSettings()`.
