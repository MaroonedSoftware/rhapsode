---
title: "Pull weights"
sidebar_label: "Pull weights"
sidebar_position: 19
mdx:
    format: "md"
---

Downloads a variant's weights ahead of its first load, as a job to follow.

**`POST`** `/engines/{engine}/pull`

:::note
SDK method: `pullEngine`
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `engine` | `string` | Yes | Path parameter. |

</details>

## Request body (`application/json`)

Accepts a [PullRequest](../models/rhapsode/pull-request.md) object.

## Response

`202` — Returns a [InstallJob](../models/rhapsode/install-job.md) object.

`403 Forbidden` — Returns a [ErrorBody](../models/rhapsode/error-body.md) object.

`404 Not Found` — Returns a [ErrorBody](../models/rhapsode/error-body.md) object.

`409 Conflict` — Returns a [ErrorBody](../models/rhapsode/error-body.md) object.
