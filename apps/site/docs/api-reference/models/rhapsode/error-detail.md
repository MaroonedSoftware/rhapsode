---
title: "ErrorDetail"
sidebar_position: 21
mdx:
    format: "md"
---

> `retryable` is a field rather than something the client infers from the status, because the
> distinction that matters is between "this request was wrong" and "this request was fine and the
> server was not". A caller that conflates them either retries a permanent failure forever or
> discards work that would have succeeded on the next pass.

<details>
<summary>Attributes (3)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `code` | `'bad_request' \| 'unknown_engine' \| 'unknown_voice' \| 'unsupported' \| 'model_unavailable' \| 'oom' \| 'overloaded' \| 'internal' \| 'forbidden' \| 'conflict'` | Yes | A closed set that § 9 grows at the end. A reader that meets a code from a newer contract must<br>not lose the envelope over it: `message` and `retryable` are the two fields that decide what<br>the caller does next, and they parse fine. The core falls back to `internal` for the code and<br>keeps the rest, rather than reporting a parse failure in place of the real error. |
| `message` | `string` | Yes |  |
| `retryable` | `boolean` | Yes |  |

</details>
