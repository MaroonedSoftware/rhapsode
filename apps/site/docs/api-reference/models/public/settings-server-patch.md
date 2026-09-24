---
title: "SettingsServerPatch"
sidebar_position: 14
mdx:
    format: "md"
---

> A change to some settings. Strict, so a misspelt key is refused rather than saved and ignored, and
> every member nullable: `null` clears the database's value and the file's, or the default, shows
> through again. The ranges here are the ones a value is refused outside of; § 10 lists them.

<details>
<summary>Attributes (3)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `port` | `number` | No | *nullable* |
| `host` | `string` | No | *nullable* |
| `shutdownGraceMs` | `number` | No | *nullable* |

</details>
