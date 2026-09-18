---
'@rhapsode/cli': minor
---

`pnpm wizard setup` takes a fresh checkout to a running server: it syncs the Python venv (offering to retry trusting PyPI when a TLS-intercepting proxy breaks pip), builds, writes `rhapsode.config.json` for the tone engine and runs the conformance suite. `pnpm wizard doctor` checks Node, pnpm, Python, the venv, the build, the config, every local engine's venv, the server port and ffmpeg, and `--fix` repairs the venv, the build and a missing config.
