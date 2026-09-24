---
title: "Speak"
sidebar_label: "Speak"
sidebar_position: 12
mdx:
    format: "md"
---

Speaks a line with one engine, streamed or as a finished file.

**`POST`** `/speak`

:::note
SDK method: `speak`
:::

## Request body (`application/json`)

Accepts a [EngineSpeakRequest](../models/rhapsode/engine-speak-request.md) object.

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
