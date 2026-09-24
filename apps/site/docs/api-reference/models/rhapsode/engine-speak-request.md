---
title: "EngineSpeakRequest"
sidebar_position: 17
mdx:
    format: "md"
---

> The public shape, which the worker's `/speak` does not share: `keepAliveSeconds` is core policy
> and a worker has no opinion about how long anything stays resident. protocol.md § 3.

Extends [`SpeakRequest`](./speak-request.md)

<details>
<summary>Attributes (2)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `engine` | `string` | Yes |  |
| `keepAliveSeconds` | `number` | No | -1 never expires, 0 frees on release. |

</details>
