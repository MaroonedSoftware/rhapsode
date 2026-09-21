---
---

`POST /engines/{engine}/reinstall` rebuilds an engine this API installed, which is how one left behind by an upgrade catches up. The new virtualenv is built in the engine's other slot, `<venvDir>/<engine>.alt` or `<venvDir>/<engine>`, and swapped in once it imports, so the engine keeps working while it builds and a failed build changes nothing. The swap waits up to ten minutes for the engine to stop speaking rather than refusing. It costs a cold load and anything installed into the old virtualenv by hand. Weights that may not be used commercially need `?accept=` only when the licence the last install accepted is not the one the catalog names now. `protocol.md` § 10.
