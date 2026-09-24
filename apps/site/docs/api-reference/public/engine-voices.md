---
title: "Voices"
sidebar_label: "Voices"
sidebar_position: 8
mdx:
    format: "md"
---

The engine's voices, built in and cloned.

**`GET`** `/engines/{engine}/voices`

:::note
SDK method: `engineVoices`
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `engine` | `string` | Yes | Path parameter. |

</details>

## Response

`200 OK` — Returns a list of [Voice](../models/rhapsode/voice.md) objects.

`404 Not Found` — Returns a [ErrorBody](../models/rhapsode/error-body.md) object.
