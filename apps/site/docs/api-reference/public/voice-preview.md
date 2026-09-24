---
title: "Voice preview"
sidebar_label: "Voice preview"
sidebar_position: 11
mdx:
    format: "md"
---

A short sample of the voice.

**`GET`** `/engines/{engine}/voices/{voice}/preview`

:::note
SDK method: `voicePreview`
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

`200 OK` — Returns `Blob`.

`404 Not Found` — Returns a [ErrorBody](../models/rhapsode/error-body.md) object.
