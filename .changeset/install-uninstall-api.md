---
'@rhapsode/core': minor
'rhapsode': minor
---

Engines can be installed and uninstalled through the API. `POST /engines/{engine}/install` queues a job that creates `<install.venvDir>/<engine>`, pip installs the adapter and the worker SDK (from `install.sourceDir`, the checkout's `python/` by default, or else the package index), imports the module to prove it, records the engine in `rhapsode.engines.json` and makes it available without a restart. `GET /installs` and `GET /installs/{job}` report jobs, which run one at a time. `DELETE /engines/{engine}` stops and removes an engine this API installed, and its virtualenv. All of them answer loopback callers, or a caller with `management.token`. `buildServer`'s third argument is now an options object: `{ managed, runner }`.
