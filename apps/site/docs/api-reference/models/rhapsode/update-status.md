---
title: "UpdateStatus"
sidebar_position: 28
mdx:
    format: "md"
---

> Whether a newer release exists, asked by the core so that no client orders versions. § 9.

<details>
<summary>Attributes (7)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `version` | `string` | Yes | This core. |
| `check` | `'off' \| 'pending' \| 'ok' \| 'failed'` | Yes | off: turned off. pending: no answer yet. failed: the last attempt got none. |
| `latest` | `string` | No | The latest release, without its `v`. Present with `ok`. |
| `updateAvailable` | `boolean` | No | Whether `latest` is newer than this core. Present with `ok`. |
| `releaseUrl` | `string` | No | The release's page, for its notes. |
| `checkedAt` | `string` | No | ISO 8601, UTC. When `latest` was read. |
| `distribution` | `'docker' \| 'source'` | Yes | Which upgrade instructions apply. |

</details>
