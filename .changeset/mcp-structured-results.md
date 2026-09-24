---
---

The MCP server's read-only tools (`list_engines`, `engine_capabilities` and `list_voices`) return
structured results. Each one declares an `outputSchema` taken from the route's response contract,
and a client can check every result against it.
