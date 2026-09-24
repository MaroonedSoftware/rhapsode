---
title: "Settings"
sidebar_label: "Settings"
sidebar_position: 24
mdx:
    format: "md"
---

Every setting, its value, where the value came from and whether a change applies now.

**`GET`** `/settings`

:::note
SDK method: `settings`
:::

## Response

`200 OK` — Returns a [Settings](../models/public/settings.md) object.

`403 Forbidden` — Returns a [ErrorBody](../models/rhapsode/error-body.md) object.
