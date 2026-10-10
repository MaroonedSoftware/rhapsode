---
title: "UpgradeSteps"
sidebar_position: 29
mdx:
    format: "md"
---

> What upgrading this box takes, worked out by the core from the image compose named. § 9.

<details>
<summary>Attributes (3)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `image` | `string` | Yes | The image reference compose.yaml named, tag and all. |
| `version` | `string` | No | Set RHAPSODE_VERSION to this in .env first. Absent when the tag already takes the release. |
| `commands` | `string[]` | Yes | Then these, in order, beside compose.yaml. |

</details>
