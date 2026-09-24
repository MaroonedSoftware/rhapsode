---
title: OpenAI clients
description: Point a client written for OpenAI's speech API at rhapsode.
---

# OpenAI clients

`POST /v1/audio/speech` takes OpenAI's speech request, so a client written for OpenAI works once it
is pointed here. It is a translation into `/speak`, not a second implementation, so cues, the length
limit and the error rules are the ones `/speak` applies.

## Point it here

Give the client `http://localhost:8080/v1` as its base URL and any API key. The key is ignored and
never logged; OpenAI's clients will not start without one.

`model` names an engine, or an engine and a build as `engine:variant`. `voice` is one of that
engine's voice ids, which `GET /engines/{engine}/voices` lists.

```python
from openai import OpenAI

client = OpenAI(base_url="http://localhost:8080/v1", api_key="unused")

with client.audio.speech.with_streaming_response.create(
    model="kokoro",
    voice="af_bella",
    input="Right, that was The Verve Pipe.",
    response_format="wav",
) as response:
    response.stream_to_file("line.wav")
```

```bash
curl -X POST localhost:8080/v1/audio/speech \
  -H 'content-type: application/json' \
  -d '{"model":"kokoro","input":"Right, that was The Verve Pipe.","voice":"af_bella","response_format":"wav"}' \
  --output line.wav
```

## Three things that surprise people

**`tts-1` and `alloy` are refused, not mapped.** A substitute engine or voice would be audio nobody
asked for, delivered with a `200`. Set the client's model and voice to real ones. A client that
cannot be told another voice name can have one cloned under the id it insists on: voice ids are
yours to choose.

**Leaving out `response_format` asks for `mp3`,** as OpenAI does, and that needs ffmpeg with
`libmp3lame` where the engine runs. The Docker image has it. Without it the answer is `unsupported`,
never a WAV with the wrong extension. Ask for `wav` when in doubt.

**What an engine cannot do is refused, not dropped.** A non-empty `instructions`, or a `speed` other
than 1 on a build with no `speed` dial, is `unsupported`. A cue in `input` that the build does not
perform is different: the core strips it, as it does for `/speak`.

## Errors

Errors come in OpenAI's envelope, because that is what its clients parse, with rhapsode's own `code`
and `retryable` inside. Every error also carries `x-should-retry`, which OpenAI's SDKs read before
the status, so they retry exactly what is worth retrying.

The full mapping, field by field, and the reasons for each refusal are in [§ 11 of the
protocol](protocol.md#11-the-openai-shim). For anything the shim cannot say, such as a delivery, a
dial or a dialogue, use [the native API](api-reference/index.md).
