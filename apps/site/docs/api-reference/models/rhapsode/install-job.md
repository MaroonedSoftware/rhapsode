---
title: "InstallJob"
sidebar_position: 30
mdx:
    format: "md"
---

<details>
<summary>Attributes (10)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes |  |
| `engine` | `string` | Yes |  |
| `kind` | `'install' \| 'pull' \| 'reinstall'` | Yes |  |
| `variant` | `string` | No | What a pull fetches, or an install fetches in step 5. |
| `state` | `'queued' \| 'running' \| 'succeeded' \| 'failed'` | Yes |  |
| `step` | `'venv' \| 'packages' \| 'verify' \| 'register' \| 'weights'` | No |  |
| `createdAt` | `string` | Yes | ISO 8601, UTC. |
| `startedAt` | `string` | No |  |
| `finishedAt` | `string` | No |  |
| `error` | `ErrorDetail` | No | Present exactly when `state` is `failed`. |

</details>
