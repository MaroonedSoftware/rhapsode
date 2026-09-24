---
title: "OpenApiDocument"
sidebar_position: 1
mdx:
    format: "md"
---

> This file, `rhapsode.types.ck` and `rhapsode.openai.ck` as OpenAPI 3.1. protocol.md § 9. Only the
> top of the document is declared: the rest is OpenAPI's own shape, and a client that wants it typed
> already has a library that types it.

<details>
<summary>Attributes (4)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `openapi` | `string` | Yes |  |
| `info` | `ApiInfo` | Yes |  |
| `paths` | `Record<string, JsonValue>` | Yes |  |
| `components` | `Record<string, JsonValue>` | No |  |

</details>
