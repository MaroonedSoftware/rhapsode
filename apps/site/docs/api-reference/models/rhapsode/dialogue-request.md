---
title: "DialogueRequest"
sidebar_position: 19
mdx:
    format: "md"
---

> A conversation in one take. protocol.md § 6. `/speak`'s fields except `text`, `voice` and
> `delivery`: a delivery reads a whole line one way, and a dialogue has more than one reader.

<details>
<summary>Attributes (8)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `turns` | `DialogueTurn[]` | Yes |  |
| `voices` | `Record<string, string>` | No | Speaker label to voice id. |
| `variant` | `string` | No |  |
| `format` | `'wav' \| 'mp3' \| 'opus' \| 'flac' \| 'pcm'` | No |  |
| `language` | `string` | No |  |
| `params` | `Record<string, number>` | No |  |
| `seed` | `number` | No |  |
| `stream` | `boolean` | No |  |

</details>
