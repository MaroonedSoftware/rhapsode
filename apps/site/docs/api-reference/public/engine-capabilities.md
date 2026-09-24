---
title: "Engine capabilities"
sidebar_label: "Engine capabilities"
sidebar_position: 7
mdx:
    format: "md"
---

What the engine can do with the variant it has loaded, and what its other variants could.

**`GET`** `/engines/{engine}/capabilities`

:::note
SDK method: `engineCapabilities`
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `engine` | `string` | Yes | Path parameter. |

</details>

## Response

`200 OK` — Returns a [Capabilities](../models/rhapsode/capabilities.md) object.

`404 Not Found` — Returns a [ErrorBody](../models/rhapsode/error-body.md) object.

`503` — Returns a [ErrorBody](../models/rhapsode/error-body.md) object.
