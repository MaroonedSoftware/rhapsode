---
title: "CreateVoiceForm"
sidebar_position: 15
mdx:
    format: "md"
---

<details>
<summary>Attributes (5)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes |  |
| `label` | `string` | No |  |
| `reference` | `Blob` | No | Exactly one of `reference` and `blend`. § 7. |
| `blend` | `string` | No | A recipe, `name(weight)+name(weight)`, over voices the engine has. |
| `transcript` | `string` | No | The words spoken in the reference. Required by an engine that continues from it. |

</details>
