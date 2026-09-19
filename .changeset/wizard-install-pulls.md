---
---

`pnpm wizard install <engine>` asks about the weights before it starts, and the server downloads them as part of the install job instead of in a second job afterwards. If only the download fails, it says the engine is installed and that `--pull` retries the download. For an engine that is already installed, `--pull` still downloads its weights on their own.
