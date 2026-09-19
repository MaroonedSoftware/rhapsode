---
---

`rhapsode-engine-chatterbox` installs upstream from commit `5de7a54` on resemble-ai/chatterbox's master instead of from PyPI's 0.1.7, because Nano is in no release yet. `turbo`, `original` and `multilingual` load, speak and clone on MPS against it unchanged. An install behind a TLS-intercepting proxy now needs `github.com,codeload.github.com` in `RHAPSODE_PIP_TRUSTED_HOSTS`, and the adapter cannot be published to PyPI until upstream releases, since PyPI refuses a direct reference.
