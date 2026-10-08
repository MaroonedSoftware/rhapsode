---
---

Closing the core stops its workers even when it never listened, as when it is embedded and answered in process. Only a listening core used to stop them, so every such close left its engines running. Closing a core whose worker had been killed by a signal no longer hangs.
