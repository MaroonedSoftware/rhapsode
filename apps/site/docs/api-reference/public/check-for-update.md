---
title: "Check for an update"
sidebar_label: "Check for an update"
sidebar_position: 3
mdx:
    format: "md"
---

Asks GitHub for the latest release now, and answers once it has.

**`POST`** `/update/check`

:::note
SDK method: `checkForUpdate`
:::

## Response

`200 OK` — Returns a [UpdateStatus](../models/rhapsode/update-status.md) object.
