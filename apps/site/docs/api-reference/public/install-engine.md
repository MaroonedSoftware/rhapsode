---
title: "Install an engine"
sidebar_label: "Install an engine"
sidebar_position: 17
mdx:
    format: "md"
---

Installs an engine from the catalog, as a job to follow.

**`POST`** `/engines/{engine}/install`

:::note
SDK method: `installEngine`
:::

## Attributes

<details>
<summary>Attributes (3)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `engine` | `string` | Yes | Path parameter. |
| `accept` | `string` | No |  |
| `pull` | `string` | No |  |

</details>

## Response

`202` — Returns a [InstallJob](../models/rhapsode/install-job.md) object.

`400 Bad Request` — Returns a [ErrorBody](../models/rhapsode/error-body.md) object.

`403 Forbidden` — Returns a [ErrorBody](../models/rhapsode/error-body.md) object.

`404 Not Found` — Returns a [ErrorBody](../models/rhapsode/error-body.md) object.

`409 Conflict` — Returns a [ErrorBody](../models/rhapsode/error-body.md) object.
