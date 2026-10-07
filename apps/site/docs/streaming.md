---
title: Speaking as text arrives
description: Speak a language model's answer while it is still being written, over a WebSocket.
---

# Speaking as text arrives

A language model writes its answer a few characters at a time. `/speak` needs the whole text, so a
caller that uses it makes the listener wait for the model to finish and then for the speech.
`GET /speak/stream` takes the text as it is written and speaks each sentence once it is complete, so
the first audio follows the first full stop rather than the last.

Every piece is spoken through `/speak` with all of its rules, so it works with every engine and
nothing about cues, dials or voices changes.

## From TypeScript

The client SDK has `speakStream`, which needs nothing but the platform's `WebSocket`:

```ts
import { speakStream } from '@maroonedsoftware/rhapsode-sdk';

const stream = speakStream('http://localhost:8080', { engine: 'kokoro', voice: 'af_bella' });

// Push the model's output as it arrives, then say it has finished.
for await (const token of answer) stream.push(token);
stream.end();

for await (const event of stream.events) {
    if (event.type === 'format') player.configure(event.contentType); // audio/L16; rate=24000; channels=1
    if (event.type === 'audio') player.write(event.data);
}
```

Pushing and reading can happen at once: the events start arriving as soon as the first sentence is
spoken, while text is still being pushed.

## The conversation

Anything that speaks WebSocket can use the route directly. The client sends JSON text frames:

| Frame | Meaning |
| --- | --- |
| `{ "type": "start", "engine": "kokoro", ... }` | First, and once. `/speak`'s fields without `text` and `stream`. |
| `{ "type": "text", "text": "..." }` | More of the text, in any size of piece. |
| `{ "type": "flush" }` | Speak what has arrived, whether or not it ends a sentence. |
| `{ "type": "end" }` | Speak what is left, then finish. |

The server answers with `ready`, then a `format` frame with the audio's `Content-Type`, then the
audio as binary frames of PCM, with a `spoken` frame after each piece giving its index, its length and
its duration. It finishes with `done`. Any error arrives as `{ "type": "error", "error": { ... } }`,
the same envelope `/speak` uses, and ends the session.

- **The first piece is the first sentence alone**, so the wait is one sentence. After that, whatever
  sentences are complete are spoken together, up to the engine's split size, so the rest reads as
  prose rather than as a list of lines.
- **The audio is PCM only.** Pieces join into one stream by being put end to end, which a WAV or an
  Ogg per piece would not do.
- **A seed** makes a session reproduce itself when its text arrives in the same frames: piece `n` gets
  `seed + n`.
- **A session that sends nothing for 60 seconds** while nothing is being spoken is closed, so a client
  that vanished does not keep its model loaded.
- **A web page from another origin is refused** unless it is listed in `management.origins`, because
  a browser lets any page open a WebSocket to your machine.

The full rules are in [the protocol](protocol.md), § 6.
