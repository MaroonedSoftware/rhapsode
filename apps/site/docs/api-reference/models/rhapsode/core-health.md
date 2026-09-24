---
title: "CoreHealth"
sidebar_position: 27
mdx:
    format: "md"
---

<details>
<summary>Attributes (5)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `contract` | `number` | Yes |  |
| `version` | `string` | Yes | The running core's package version, for display. Not the contract. § 9. |
| `status` | `'ok' \| 'degraded'` | Yes |  |
| `engines` | `EngineSummary[]` | Yes |  |
| `residency` | `ResidencySummary` | Yes |  |

</details>
