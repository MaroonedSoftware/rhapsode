---
title: "Reinstall outdated engines"
sidebar_label: "Reinstall outdated engines"
sidebar_position: 21
mdx:
    format: "md"
---

Reinstalls every engine an upgrade left behind.

**`POST`** `/installs/outdated`

:::note
SDK method: `reinstallOutdated`
:::

## Response

`202` — Returns a [ReinstallOutdated](../models/rhapsode/reinstall-outdated.md) object.

`403 Forbidden` — Returns a [ErrorBody](../models/rhapsode/error-body.md) object.
