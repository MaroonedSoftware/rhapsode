---
'@rhapsode/core': patch
---

`POST /speak` refuses a field the contract does not declare with `bad_request` naming it. A misspelling such as `streaming: false` used to be ignored, and the caller got a stream it thought it had turned off.
