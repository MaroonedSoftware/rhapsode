---
title: "Install job events"
sidebar_label: "Install job events"
sidebar_position: 23
mdx:
    format: "md"
---

An install job's progress and output as server-sent events.

**`GET`** `/installs/{job}/events`

:::note
SDK method: `installJobEvents`
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `job` | `string` | Yes | Path parameter. |

</details>

## Response

`200 OK` — Returns `string`.

`403 Forbidden` — Returns a [ErrorBody](../models/rhapsode/error-body.md) object.

`404 Not Found` — Returns a [ErrorBody](../models/rhapsode/error-body.md) object.
