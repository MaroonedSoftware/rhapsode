---
'@rhapsode/core': patch
---

Management routes refuse a request from a browser page that did not come from this machine or from an origin listed in the new `management.origins`, closing a hole where any website the operator visited could install or uninstall an engine by making their browser POST to localhost. A request forwarded by a proxy on this machine is local only if every address in `X-Forwarded-For` is.
