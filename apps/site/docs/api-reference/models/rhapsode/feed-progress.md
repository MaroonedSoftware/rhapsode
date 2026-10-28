---
title: "FeedProgress"
sidebar_position: 36
mdx:
    format: "md"
---

> One event on a job's stream, `GET /installs/{job}/events`. The shape is ServerKit's server feed,
> declared here so a client can parse it without depending on ServerKit.

<details>
<summary>Attributes (4)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `phase` | `string` | Yes | The job's step. |
| `index` | `number` | Yes |  |
| `total` | `number` | Yes |  |
| `status` | `'running' \| 'done' \| 'failed'` | Yes |  |

</details>
