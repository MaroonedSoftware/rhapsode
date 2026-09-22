---
---

`pnpm wizard settings` lists every setting the running server has, where each came from and whether
a change to it applies now or at the next start, with a column for any change waiting on a restart.
`pnpm wizard settings <key>` shows one, `pnpm wizard settings <key> <value>` changes it and
`--unset` clears it back to the config file's value or the default, all through `/settings`, so the
wizard and the web page cannot disagree about what a setting is (`protocol.md` § 10). A value is read
as the kind the setting already has: a number, true or false, or a comma-separated list. `-` reads
it from stdin, which is how to give a management token without it landing in the shell's history.
It is one command in the shape of `git config` rather than `settings set` and `settings unset`,
because a `settings` that both listed and held subcommands took `--server` from under them.
