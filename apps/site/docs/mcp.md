---
title: MCP clients
description: Give an agent rhapsode's engines as tools, over the Model Context Protocol.
---

# MCP clients

`POST /mcp` is an MCP server. An agent that speaks the Model Context Protocol can use it to find an
engine, pick a voice and speak a line, with no glue code. Each tool is a request to one of the
public routes, so an agent is held to the rules `curl` is held to: the length limit, the handling
of cues, and the errors.

## Point it here

The transport is Streamable HTTP, stateless, at `http://localhost:8080/mcp`. For Claude Code:

```bash
claude mcp add --transport http rhapsode http://localhost:8080/mcp
```

A client that only launches stdio servers, such as Claude Desktop's config file, needs a bridge to
the URL. `mcp-remote` is one. It wants `--allow-http` for a plain-HTTP address that is not
`localhost`:

```json
{
  "mcpServers": {
    "rhapsode": { "command": "npx", "args": ["-y", "mcp-remote", "http://tower:8080/mcp", "--allow-http"] }
  }
}
```

## The tools

| Tool | What it does |
| --- | --- |
| `list_engines` | Every installed engine, with its variants and licences. Start here. |
| `engine_capabilities` | What one engine can do: formats, languages, the length limit, cues, deliveries and dials. |
| `list_voices` | The voices one engine speaks in. |
| `speak` | Speaks a line and returns the audio. Takes what `POST /speak` takes, except `stream`. |
| `speak_dialogue` | Speaks a conversation in one take, on an engine that declares dialogue. |

Nothing from the management API is a tool. An agent cannot install an engine, unload a model or
change a setting through MCP.

## What comes back

`speak` and `speak_dialogue` return the audio as MCP audio content, base64 with its mime type, and
a line of text naming the engine, the voice, the size and the duration. The format is `wav` unless
the call asks for another one, because `wav` needs nothing on the server while `mp3` and `opus`
need ffmpeg. What happens to the audio depends on the client: it might play it, save it, pass it to
the model, or show only the text.

A refusal comes back as a tool result marked as an error, with rhapsode's own code and message, such
as `unknown_voice` followed by the voices there are. The agent can read that and try again.

## Who may call it

Anybody who may call `/speak`, which is anybody who can reach the port. No token is asked for. A
browser page is refused unless it comes from this machine or from an origin listed in
`management.origins`, because otherwise any site the operator visited could drive the server
through their browser.

The rules and the reasons are in [§ 12 of the protocol](protocol.md#12-the-mcp-server).
