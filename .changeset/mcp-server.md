---
---

The server speaks MCP at `POST /mcp`, so an agent such as Claude Code can use rhapsode's engines as
tools. `list_engines`, `engine_capabilities` and `list_voices` answer what the public routes answer.
The endpoint is open to the same callers as `/speak`, and it refuses browser pages from origins
that are not this machine's or listed in `management.origins`.

`speak` and `speak_dialogue` return the audio as MCP audio content. They use wav unless another
format is asked for, because wav needs no ffmpeg on the server.
