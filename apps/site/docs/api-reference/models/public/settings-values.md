---
title: "SettingsValues"
sidebar_position: 11
mdx:
    format: "md"
---

> What the running process is using. A setting waiting for a restart shows its old value here.

<details>
<summary>Attributes (8)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `server` | `SettingsServer` | Yes |  |
| `log` | `SettingsLog` | Yes |  |
| `residency` | `SettingsResidency` | Yes |  |
| `workers` | `SettingsWorkers` | Yes |  |
| `install` | `SettingsInstall` | Yes |  |
| `management` | `SettingsManagement` | Yes |  |
| `update` | `SettingsUpdate` | Yes |  |
| `engines` | `Record<string, SettingsEngine>` | Yes | One per engine in the registry. |

</details>
