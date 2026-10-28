---
title: "FeedEvent"
sidebar_position: 37
mdx:
    format: "md"
---

<details>
<summary>Attributes (9)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `number` | Yes | The Last-Event-ID resume key. |
| `ts` | `string` | Yes |  |
| `source` | `string` | Yes |  |
| `level` | `'debug' \| 'info' \| 'warn' \| 'error'` | Yes |  |
| `kind` | `'progress' \| 'status' \| 'log' \| 'error' \| 'heartbeat'` | Yes |  |
| `message` | `string` | No |  |
| `correlationId` | `string` | No | The job id. |
| `progress` | `FeedProgress` | No |  |
| `data` | `JsonValue` | No |  |

</details>
