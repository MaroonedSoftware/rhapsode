---
title: "CatalogEntry"
sidebar_position: 29
mdx:
    format: "md"
---

> What exists, installed or not. `/engines` is what this box has; this is what it could have, with
> both licences, because the weights licence is only worth reading before the install.

<details>
<summary>Attributes (9)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes |  |
| `displayName` | `string` | Yes |  |
| `license` | `License` | Yes |  |
| `package` | `string` | Yes | The Python distribution the installer installs. |
| `defaultVariant` | `string` | No |  |
| `installed` | `'no' \| 'installing' \| 'yes'` | Yes |  |
| `managed` | `boolean` | Yes | Installed through the API, so removable by it. |
| `workerVersion` | `string` | No | As on EngineSummary, for an installed engine. § 9. |
| `outdated` | `boolean` | No | As on EngineSummary. § 9. |

</details>
