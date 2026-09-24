---
title: "EngineSummary"
sidebar_position: 23
mdx:
    format: "md"
---

<details>
<summary>Attributes (10)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes |  |
| `displayName` | `string` | Yes |  |
| `license` | `License` | Yes |  |
| `process` | `'down' \| 'starting' \| 'up' \| 'draining' \| 'failed'` | Yes |  |
| `model` | `'unloaded' \| 'loading' \| 'loaded' \| 'unloading'` | Yes |  |
| `variant` | `string` | No |  |
| `lastError` | `string` | No |  |
| `restarts` | `number` | Yes |  |
| `workerVersion` | `string` | No | `rhapsode-worker` as installed in this engine's venv, read from the venv rather than asked of<br>the worker so that a `down` engine still answers. A diagnostic, never negotiation: one that<br>differs from the core's version is a pin an upgrade broke. Absent where nothing can say, which<br>includes every remote engine. protocol.md § 9. |
| `outdated` | `boolean` | No | Whether `workerVersion` differs from this core's version, so no client compares the two.<br>Absent exactly when `workerVersion` is. A warning, never a refusal. protocol.md § 9. |

</details>
