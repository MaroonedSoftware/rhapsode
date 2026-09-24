---
title: "Reinstall an engine"
sidebar_label: "Reinstall an engine"
sidebar_position: 18
mdx:
    format: "md"
---

Rebuilds an installed engine beside the old one and swaps it in once it works.

**`POST`** `/engines/{engine}/reinstall`

:::note
SDK method: `reinstallEngine`
:::

## Attributes

<details>
<summary>Attributes (2)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `engine` | `string` | Yes | Path parameter. |
| `accept` | `string` | No |  |

</details>

## Response

`202` — Returns a [InstallJob](../models/rhapsode/install-job.md) object.

`400 Bad Request` — Returns a [ErrorBody](../models/rhapsode/error-body.md) object.

`403 Forbidden` — Returns a [ErrorBody](../models/rhapsode/error-body.md) object.

`404 Not Found` — Returns a [ErrorBody](../models/rhapsode/error-body.md) object.

`409 Conflict` — Returns a [ErrorBody](../models/rhapsode/error-body.md) object.
