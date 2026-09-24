---
title: Help
description: The things that go wrong most often, and what each one means.
---

# Help

The server's refusals are written for a person, so the `message` in an error usually says what to
do. These are the cases where it helps to know why.

## An install answers 403

Installing runs pip, so the install routes answer this machine and nobody else unless
`management.token` is set. In Docker a published port is never loopback to the core, so install
through the page's port, `http://localhost:8081/api/...`, which presents the token for you, or send
`Authorization: Bearer <token>` yourself. A request from a browser page on another origin is refused
even with a token. [§ 10](protocol.md#who-may-call-them) has the whole rule, and [running
one](operating.md#installing-from-the-page) has what it means for Docker.

## pip cannot verify a certificate

Something on your network intercepts TLS. Start the server with
`RHAPSODE_PIP_TRUSTED_HOSTS=pypi.org,files.pythonhosted.org`, and add
`github.com,codeload.github.com` for Chatterbox. A client cannot ask for this: weakening
verification is the operator's decision.

## The first line takes a minute

An engine's weights download on its first load unless they were pulled ahead of time, 3.8 GB for
Chatterbox's `turbo`. Pull them at install (the page and the wizard offer to), or with `POST
/engines/{engine}/pull`, which downloads without loading anything.

## A request waits and nothing happens

With one model allowed on the card, a long synthesis on one engine makes a request for another wait
its turn. `GET /residency` and `residency.waiting` in `GET /health` show it. It is correct, and it
is not a hang.

## The audio ends early, or the connection breaks

A `/speak` that fails after its headers have gone breaks the connection rather than closing it
cleanly, because a clean close would hand you a short file that looks like a success. Ask with
`"stream": false` and the same failure arrives as an ordinary error with a code, at the cost of
waiting for the whole line.

## A cue was not performed

The core strips every cue the loaded build does not claim, before the engine sees the line. That is
why an engine never reads the word "laugh" out loud. `GET /engines/{engine}/capabilities` lists what
the loaded build performs under `current.cues`; on Chatterbox, `turbo` performs cues and `original`
does not.

## An OpenAI client gets unknown_engine or unknown_voice

`tts-1` and `alloy` are not an engine and a voice here, and nothing maps them. Set the client's
model to an engine id and its voice to one of that engine's. See [OpenAI clients](openai.md).

## mp3 is unsupported

`mp3`, `opus` and `flac` need ffmpeg where the engine runs. The Docker image has it; a checkout
needs it installed. `wav` and `pcm` never do.

## An engine keeps restarting, or reports failed

After `maxRestarts` crashes the engine is reported `failed` and left alone, because a broken
virtualenv does not get better with backoff. `GET /health` shows `restarts` and whether the engine
is `outdated`, which after an upgrade is fixed by a reinstall. [What to
watch](operating.md#what-to-watch) has the rest.

## From a checkout

`pnpm wizard doctor` says what is wrong with the checkout without changing anything, and `pnpm
wizard doctor --fix` repairs what it can.

## Still stuck

Search or open an issue on [GitHub](https://github.com/MaroonedSoftware/rhapsode/issues). A security
problem goes to [a private
advisory](https://github.com/MaroonedSoftware/rhapsode/security/advisories/new) instead.
