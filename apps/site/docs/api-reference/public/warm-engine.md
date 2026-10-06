---
title: "Warm a variant"
sidebar_label: "Warm a variant"
sidebar_position: 20
mdx:
    format: "md"
---

Loads a variant that compiles and unloads it, so its first request does not compile.

**`POST`** `/engines/{engine}/warm`

:::note
SDK method: `warmEngine`
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `engine` | `string` | Yes | Path parameter. |

</details>

## Request body (`application/json`)

Accepts a [WarmRequest](../models/rhapsode/warm-request.md) object.

## Response

`202` — Returns a [InstallJob](../models/rhapsode/install-job.md) object.

`403 Forbidden` — Returns a [ErrorBody](../models/rhapsode/error-body.md) object.

`404 Not Found` — Returns a [ErrorBody](../models/rhapsode/error-body.md) object.

`409 Conflict` — Returns a [ErrorBody](../models/rhapsode/error-body.md) object.
