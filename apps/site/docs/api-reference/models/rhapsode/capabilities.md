---
title: "Capabilities"
sidebar_position: 13
mdx:
    format: "md"
---

<details>
<summary>Attributes (7)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `contract` | `number` | Yes | The contract major this worker settled on. § 9. |
| `engine` | `EngineIdentity` | Yes |  |
| `license` | `License` | Yes |  |
| `device` | `Device` | Yes |  |
| `current` | `CurrentVariant` | No |  |
| `variants` | `Record<string, Variant>` | Yes |  |
| `formats` | `string[]` | Yes | What this worker can actually encode, here and now. |

</details>
