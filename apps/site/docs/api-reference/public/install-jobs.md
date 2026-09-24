---
title: "Install jobs"
sidebar_label: "Install jobs"
sidebar_position: 20
mdx:
    format: "md"
---

Every install job, running and finished.

**`GET`** `/installs`

:::note
SDK method: `installJobs`
:::

## Response

`200 OK` — Returns a list of [InstallJob](../models/rhapsode/install-job.md) objects.

`403 Forbidden` — Returns a [ErrorBody](../models/rhapsode/error-body.md) object.
