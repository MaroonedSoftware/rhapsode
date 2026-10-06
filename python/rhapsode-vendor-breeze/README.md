# rhapsode-vendor-breeze

BreezeBlue's [Breeze TTS 2](https://github.com/breezeblue-ai/breeze-tts) inference code, copied at
commit `58ec70c` and given a pyproject, because upstream has none and pip cannot install a repository
without one. `rhapsode-engine-breeze` depends on it, and the installer puts both in the engine's
virtualenv in one resolve (protocol.md § 10).

`breeze_infer/` and `models/` are upstream's, unmodified. Nothing in them is this repository's, so
nothing in them is linted or formatted here. To move to a newer upstream, copy both directories from
the new commit over these, update the commit in `NOTICE` and here, and check `requirements.txt` there
against `dependencies` in `pyproject.toml`.

The code is Apache-2.0. **The weights are not**: they are for research and non-commercial use only.
See `NOTICE`.
