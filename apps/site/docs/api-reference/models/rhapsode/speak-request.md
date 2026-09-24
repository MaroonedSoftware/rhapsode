---
title: "SpeakRequest"
sidebar_position: 16
mdx:
    format: "md"
---

<details>
<summary>Attributes (9)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `text` | `string` | Yes |  |
| `voice` | `string` | No |  |
| `variant` | `string` | No | Absent means whatever is loaded. |
| `format` | `'wav' \| 'mp3' \| 'opus' \| 'flac' \| 'pcm'` | No |  |
| `language` | `string` | No | From the effective variant's `languages`. |
| `delivery` | `'hushed' \| 'frantic'` | No | Closed, and deliberately has no word for "ordinary". |
| `params` | `Record<string, number>` | No | Validated against the effective variant's dials. |
| `seed` | `number` | No |  |
| `stream` | `boolean` | No |  |

</details>
