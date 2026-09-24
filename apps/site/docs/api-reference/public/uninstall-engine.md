---
title: "Uninstall an engine"
sidebar_label: "Uninstall an engine"
sidebar_position: 15
mdx:
    format: "md"
---

Removes an engine this API installed.

**`DELETE`** `/engines/{engine}`

:::note
SDK method: `uninstallEngine`
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `engine` | `string` | Yes | Path parameter. |

</details>

## Response

`204 No Content`

`403 Forbidden` — Returns a [ErrorBody](../models/rhapsode/error-body.md) object.

`404 Not Found` — Returns a [ErrorBody](../models/rhapsode/error-body.md) object.

`409 Conflict` — Returns a [ErrorBody](../models/rhapsode/error-body.md) object.
