---
title: "OpenAISpeechRequest"
sidebar_position: 1
mdx:
    format: "md"
---

> Strict, like every request here: OpenAI's own API refuses a field it does not recognise with a 400,
> so a refusal holds a client to nothing it was not already held to.

<details>
<summary>Attributes (7)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `model` | `string` | Yes | An engine id, or `engine:variant`. |
| `input` | `string` | Yes |  |
| `voice` | `string` | No | Absent means the engine's default. |
| `response_format` | `'mp3' \| 'opus' \| 'aac' \| 'flac' \| 'wav' \| 'pcm'` | No | Absent means mp3. aac is always refused. |
| `speed` | `number` | No | Carried by a `speed` dial, or refused. |
| `instructions` | `string` | No | Refused unless empty. |
| `stream_format` | `'audio' \| 'sse'` | No | sse is always refused. |

</details>
