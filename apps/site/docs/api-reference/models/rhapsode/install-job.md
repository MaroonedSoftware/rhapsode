---
title: "InstallJob"
sidebar_position: 31
mdx:
    format: "md"
---

<details>
<summary>Attributes (10)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes |  |
| `engine` | `string` | Yes |  |
| `kind` | `'install' \| 'pull' \| 'reinstall' \| 'warm'` | Yes |  |
| `variant` | `string` | No | What a pull fetches or a warm loads, or an install fetches in step 5. |
| `state` | `'queued' \| 'running' \| 'succeeded' \| 'failed'` | Yes |  |
| `step` | `'venv' \| 'packages' \| 'verify' \| 'register' \| 'weights' \| 'warm'` | No |  |
| `createdAt` | `string` | Yes | ISO 8601, UTC. |
| `startedAt` | `string` | No |  |
| `finishedAt` | `string` | No |  |
| `error` | `ErrorDetail` | No | Present exactly when `state` is `failed`. |

</details>
