---
title: "OpenAI speech"
sidebar_label: "OpenAI speech"
sidebar_position: 1
mdx:
    format: "md"
---

OpenAI's speech route, where the model names an engine or engine:variant.

**`POST`** `/v1/audio/speech`

:::note
SDK method: `openaiSpeech`
:::

## Request body (`application/json`)

Accepts a [OpenAISpeechRequest](../models/openai/open-aispeech-request.md) object.

## Response

`200 OK` `audio/mpeg` — Returns `Blob`.

`200` `audio/opus` — Returns `Blob`.

`200` `audio/flac` — Returns `Blob`.

`200` `audio/wav` — Returns `Blob`.

`200` `audio/l16` — Returns `Blob`.

`400 Bad Request` — Returns a [OpenAIErrorBody](../models/openai/open-aierror-body.md) object.

`404 Not Found` — Returns a [OpenAIErrorBody](../models/openai/open-aierror-body.md) object.

`422 Unprocessable Entity` — Returns a [OpenAIErrorBody](../models/openai/open-aierror-body.md) object.

`429` — Returns a [OpenAIErrorBody](../models/openai/open-aierror-body.md) object.

`500 Internal Server Error` — Returns a [OpenAIErrorBody](../models/openai/open-aierror-body.md) object.

`503` — Returns a [OpenAIErrorBody](../models/openai/open-aierror-body.md) object.
