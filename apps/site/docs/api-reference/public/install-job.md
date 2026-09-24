---
title: "Install job"
sidebar_label: "Install job"
sidebar_position: 22
mdx:
    format: "md"
---

One install job and where it has got to.

**`GET`** `/installs/{job}`

:::note
SDK method: `installJob`
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `job` | `string` | Yes | Path parameter. |

</details>

## Response

`200 OK` — Returns a [InstallJob](../models/rhapsode/install-job.md) object.

`403 Forbidden` — Returns a [ErrorBody](../models/rhapsode/error-body.md) object.

`404 Not Found` — Returns a [ErrorBody](../models/rhapsode/error-body.md) object.
