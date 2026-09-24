---
title: "Update settings"
sidebar_label: "Update settings"
sidebar_position: 25
mdx:
    format: "md"
---

Changes settings in one transaction, and answers the whole document after the write.

**`PATCH`** `/settings`

:::note
SDK method: `updateSettings`
:::

## Request body (`application/json`)

Accepts a [SettingsPatch](../models/public/settings-patch.md) object.

## Response

`200 OK` — Returns a [Settings](../models/public/settings.md) object.

`400 Bad Request` — Returns a [ErrorBody](../models/rhapsode/error-body.md) object.

`403 Forbidden` — Returns a [ErrorBody](../models/rhapsode/error-body.md) object.

`404 Not Found` — Returns a [ErrorBody](../models/rhapsode/error-body.md) object.

`409 Conflict` — Returns a [ErrorBody](../models/rhapsode/error-body.md) object.

`422 Unprocessable Entity` — Returns a [ErrorBody](../models/rhapsode/error-body.md) object.
