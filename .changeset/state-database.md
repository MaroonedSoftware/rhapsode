---
---

The server keeps the engines it installed in `rhapsode.db`, a SQLite database beside the config
file, rather than in `rhapsode.engines.json` (`protocol.md` § 10, "The state database"). A server
that finds the old file imports it once and renames it `rhapsode.engines.json.imported`, so an
upgrade needs nothing done by hand and a downgrade has the file to go back to. It is the ground for
settings changed through the API, which make a second writer, and a transaction each is what keeps
an install and a settings change from losing each other's write. SQLite ships with Node, so this
adds no dependency, but it needs Node 22.13 or newer. The database is created readable by its owner
only and is written once at boot, so a container restarted as a different user than the one that
created it refuses to start and names the file, rather than failing at the first install.
