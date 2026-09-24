---
title: "OpenAIErrorDetail"
sidebar_position: 2
mdx:
    format: "md"
---

<details>
<summary>Attributes (5)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `message` | `string` | Yes |  |
| `type` | `'invalid_request_error' \| 'server_error'` | Yes |  |
| `param` | `string` | No | The request field the failure is about. |
| `code` | `string` | Yes | The taxonomy code from protocol.md § 6. A string rather than the enum, so a code from a newer<br>contract does not cost a client the envelope. § 9. |
| `retryable` | `boolean` | Yes |  |

</details>
