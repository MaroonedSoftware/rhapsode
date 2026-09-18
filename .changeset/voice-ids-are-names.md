---
---

`rhapsode-worker`: a voice id must be a name (letters, digits, `-` and `_`, starting with a letter or digit, at most 64 characters), checked on create, delete, speak and preview before any adapter sees it. Before this, an id of `../../x` wrote a clone's reference outside the voice directory, and `*` matched whichever voice sorted first. The SDK now depends on `python-multipart`, without which every `POST /voices` failed with a 500.
