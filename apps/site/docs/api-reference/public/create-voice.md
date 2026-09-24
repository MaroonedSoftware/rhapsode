---
title: "Create a voice"
sidebar_label: "Create a voice"
sidebar_position: 9
mdx:
    format: "md"
---

Creates a voice from a reference, such as a clip to clone, or from a blend of voices the engine has.

**`POST`** `/engines/{engine}/voices`

:::note
SDK method: `createVoice`
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `engine` | `string` | Yes | Path parameter. |

</details>

## Request body (`multipart/form-data`)

Accepts a [CreateVoiceForm](../models/rhapsode/create-voice-form.md) object.

## Response

`201 Created` — Returns a [Voice](../models/rhapsode/voice.md) object.

`400 Bad Request` — Returns a [ErrorBody](../models/rhapsode/error-body.md) object.

`403 Forbidden` — Returns a [ErrorBody](../models/rhapsode/error-body.md) object.

`404 Not Found` — Returns a [ErrorBody](../models/rhapsode/error-body.md) object.

`422 Unprocessable Entity` — Returns a [ErrorBody](../models/rhapsode/error-body.md) object.
