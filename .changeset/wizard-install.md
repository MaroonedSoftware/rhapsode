---
'@rhapsode/cli': minor
---

`pnpm wizard install <engine>` installs an engine through the running server: it shows both licences and asks, follows the install as it happens, and offers to download the default variant's weights. `--yes` accepts the licences from a script, `--pull` downloads without asking, and `--server` and `--token` reach a server on another machine. It is a client of `docs/protocol.md` § 10 and holds no install logic of its own.
