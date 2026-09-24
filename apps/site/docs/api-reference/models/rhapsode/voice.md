---
title: "Voice"
sidebar_position: 14
mdx:
    format: "md"
---

<details>
<summary>Attributes (6)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes |  |
| `label` | `string` | Yes |  |
| `description` | `string` | No |  |
| `spec` | `string` | Yes | Opaque. Changes whenever the rendering would. Never parse it. |
| `tags` | `string[]` | No |  |
| `previewUrl` | `string` | No | Worker-scoped; the core rewrites it on the way out. |

</details>
