---
---

`rhapsode-worker` keeps the label a clone was created with, in `.labels.json` in the voice store, and applies it when listing, so every adapter keeps labels without doing anything. Before, a voice created as "The Announcer" was listed as "Announcer" a moment later.
