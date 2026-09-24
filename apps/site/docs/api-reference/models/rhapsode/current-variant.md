---
title: "CurrentVariant"
sidebar_position: 9
mdx:
    format: "md"
---

> The resident build, and everything true only while it is resident. Absent from the capability
> document entirely when nothing is loaded, because a worker in up(unloaded) has nothing to
> describe and an invented answer is worse than no answer.

Extends [`Variant`](./variant.md)

<details>
<summary>Attributes (5)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `variant` | `string` | Yes |  |
| `cloning` | `Cloning` | Yes |  |
| `blending` | `Blending` | No | Absent means no, so a worker that predates it is read correctly. |
| `streaming` | `Streaming` | Yes |  |
| `nativeFormat` | `NativeFormat` | Yes |  |

</details>
