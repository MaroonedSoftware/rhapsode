---
'@rhapsode/core': minor
---

A catalog record can name the Python versions its engine installs on. With uv the install asks for an interpreter in that range; without it, the install fails at the `venv` step naming the range and the interpreter it has, rather than letting pip resolve an older release of the engine's dependencies.
