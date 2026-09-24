---
title: "ReinstallSkipped"
sidebar_position: 31
mdx:
    format: "md"
---

> An outdated engine `POST /installs/outdated` did not queue, and why: each is one a single
> reinstall would have to ask somebody about. § 10.

<details>
<summary>Attributes (2)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `engine` | `string` | Yes |  |
| `reason` | `'licence' \| 'busy' \| 'uncatalogued'` | Yes | Needs `accept`; has a job already; the catalog no longer has it. |

</details>
