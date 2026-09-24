---
title: "Dialogue"
sidebar_label: "Dialogue"
sidebar_position: 13
mdx:
    format: "md"
---

A conversation between speakers in one take, on a variant that declares dialogue.

**`POST`** `/engines/{engine}/dialogue`

:::note
SDK method: `dialogue`
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `engine` | `string` | Yes | Path parameter. |

</details>

## Request body (`application/json`)

Accepts a [EngineDialogueRequest](../models/rhapsode/engine-dialogue-request.md) object.

## Response

`200 OK` `audio/wav` — Returns `Blob`.

`200` `audio/mpeg` — Returns `Blob`.

`200` `audio/opus` — Returns `Blob`.

`200` `audio/flac` — Returns `Blob`.

`200` `audio/l16` — Returns `Blob`.

`400 Bad Request` — Returns a [ErrorBody](../models/rhapsode/error-body.md) object.

`404 Not Found` — Returns a [ErrorBody](../models/rhapsode/error-body.md) object.

`422 Unprocessable Entity` — Returns a [ErrorBody](../models/rhapsode/error-body.md) object.

`429` — Returns a [ErrorBody](../models/rhapsode/error-body.md) object.

`503` — Returns a [ErrorBody](../models/rhapsode/error-body.md) object.
