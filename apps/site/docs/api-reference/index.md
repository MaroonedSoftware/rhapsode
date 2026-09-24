---
title: The API
sidebar_label: Overview
sidebar_position: 0
description: Where the API is, who may call which routes, and the clients that speak it.
---

# The API

Every client talks to one HTTP API on the core, `http://127.0.0.1:8080` by default. The pages in this
section are generated from `contracts/`, the source of truth for every request and response shape, so
they cannot describe a route the server does not have. The same contracts produce
[the OpenAPI 3.1 document](pathname:///rhapsode/openapi.yaml), and a running core serves its own at
`GET /openapi.json`, which describes that core rather than this site's copy of the latest release.

The prose that says why each route behaves as it does is [the protocol](../protocol.md). Where a page
here says what, the protocol says why, and where the two disagree the protocol is right and the
other one is a bug.

## Who may call what

**Speaking is open.** `POST /speak`, the engines and their capabilities, voices and previews, and
OpenAI's `POST /v1/audio/speech` answer anybody who can reach the port. The worst a stranger can do
with them is make it talk.

**Managing is not.** Installing, uninstalling, reinstalling, pulling weights, unloading, creating or
deleting a voice, the install jobs and the settings answer callers on this machine, and nobody else unless
`management.token` is set, in which case `Authorization: Bearer <token>` is admitted from anywhere.
An install runs pip, so a management route open to the LAN would be remote code execution for anyone
on it. `GET /catalog` is the exception and answers everybody. The full rules, including how a web
page and a proxy are judged, are
[§ 10, "Who may call them"](../protocol.md#who-may-call-them).

## Clients

- **TypeScript**: [`@maroonedsoftware/rhapsode-sdk`](https://www.npmjs.com/package/@maroonedsoftware/rhapsode-sdk),
  generated from the same contracts and depending on nothing.

  ```ts
  import { RhapsodeSdk } from '@maroonedsoftware/rhapsode-sdk';

  const rhapsode = new RhapsodeSdk({ baseUrl: 'http://127.0.0.1:8080' });
  const engines = await rhapsode.public.engines();
  ```

  A job's event stream is the one operation it cannot serve, because the stream does not end on its
  own: read `/installs/{job}/events` with an `EventSource`.
- **Any OpenAI client**: point its base URL at `http://127.0.0.1:8080/v1` and name an engine as the
  model. See [OpenAI speech](openai/openai-speech.md) and
  [§ 11](../protocol.md#11-the-openai-shim) for what it maps and what it refuses.
- **Anything else**: the OpenAPI document above, or `curl`.

## Errors

A refusal on the native routes is one envelope: a `code` a client branches on, a `message` written for a
person, and whether trying again could help.

```json
{ "error": { "code": "unknown_voice", "message": "no voice \"narrator_99\"", "retryable": false } }
```

The codes and when each is used are in [§ 6, "Errors"](../protocol.md#errors). The OpenAI route
answers in OpenAI's own envelope instead, so that its clients can read it.
