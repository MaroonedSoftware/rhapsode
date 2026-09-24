---
title: "ResidentModel"
sidebar_position: 25
mdx:
    format: "md"
---

> One model on the card, and what the core knows about it. protocol.md § 3.

<details>
<summary>Attributes (7)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `engine` | `string` | Yes |  |
| `variant` | `string` | Yes |  |
| `leases` | `number` | Yes | Requests still speaking it. A model with leases is not evictable. |
| `lastUsedAt` | `string` | Yes | ISO 8601, UTC. |
| `expiresAt` | `string` | No | Absent while it is speaking, or when its keep-alive says never. |
| `keepAliveSeconds` | `number` | Yes | The one in force here: request, then engine, then server. |
| `sizeBytes` | `number` | No | What the worker measured the model taking, where it could. |

</details>
