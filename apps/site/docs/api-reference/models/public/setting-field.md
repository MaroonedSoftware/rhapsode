---
title: "SettingField"
sidebar_position: 12
mdx:
    format: "md"
---

<details>
<summary>Attributes (4)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `key` | `string` | Yes | Dotted: residency.keepAliveSeconds, engines.kokoro.keepAliveSeconds. |
| `source` | `'default' \| 'config' \| 'database'` | Yes | The layer the value in use came from. |
| `applies` | `'live' \| 'restart'` | Yes | Whether a change takes effect when it is written. |
| `saved` | `JsonValue` | No | A value waiting for a restart. For management.token, `true` and never the token. |

</details>
