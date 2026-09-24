---
title: "Unload an engine"
sidebar_label: "Unload an engine"
sidebar_position: 16
mdx:
    format: "md"
---

Frees the engine's model now, rather than waiting out its keep-alive.

**`POST`** `/engines/{engine}/unload`

:::note
SDK method: `unloadEngine`
:::

## Attributes

<details>
<summary>Attributes (2)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `engine` | `string` | Yes | Path parameter. |
| `mode` | `'terminate' \| 'unload'` | No |  |

</details>

## Response

`200 OK` — Returns a [EngineSummary](../models/rhapsode/engine-summary.md) object.

`403 Forbidden` — Returns a [ErrorBody](../models/rhapsode/error-body.md) object.

`404 Not Found` — Returns a [ErrorBody](../models/rhapsode/error-body.md) object.

`409 Conflict` — Returns a [ErrorBody](../models/rhapsode/error-body.md) object.
