---
'@rhapsode/core': minor
---

`POST /v1/audio/speech` answers OpenAI's speech request, translated into `/speak` (protocol.md § 11). `model` is an engine id or `engine:variant`. `tts-1` and `alloy` are refused rather than substituted, and so are `aac`, `stream_format: "sse"`, non-empty `instructions`, and a `speed` other than 1 on a variant with no `speed` dial. Errors use OpenAI's envelope, keep the taxonomy code in `code`, and carry `x-should-retry` from `retryable`.
