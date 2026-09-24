---
title: "Delete a voice"
sidebar_label: "Delete a voice"
sidebar_position: 10
mdx:
    format: "md"
---

Deletes a voice.

**`DELETE`** `/engines/{engine}/voices/{voice}`

:::note
SDK method: `deleteVoice`
:::

## Attributes

<details>
<summary>Attributes (2)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `engine` | `string` | Yes | Path parameter. |
| `voice` | `string` | Yes | Path parameter. |

</details>

## Response

`204 No Content`

`400 Bad Request` — Returns a [ErrorBody](../models/rhapsode/error-body.md) object.

`403 Forbidden` — Returns a [ErrorBody](../models/rhapsode/error-body.md) object.

`404 Not Found` — Returns a [ErrorBody](../models/rhapsode/error-body.md) object.

`422 Unprocessable Entity` — Returns a [ErrorBody](../models/rhapsode/error-body.md) object.
