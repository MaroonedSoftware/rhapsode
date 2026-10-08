---
---

The core now removes emoji and markdown emphasis from the text before a worker sees it, on `/speak`, `/dialogue`, the OpenAI shim and MCP alike. Text from a language model arrives decorated, and engines voiced the decoration: Chatterbox turbo spent over half as long again on a sentence with `*really*` and `**Jon**` in it, or with a few emoji. Emphasis keeps the words it wrapped. `snake_case`, `2 * 3` and every kind of bracket are left alone, so cues and engine tags are unaffected. `©`, `®` and `™` stay, because they are read as words. `withoutDecoration` is exported from `@rhapsode/contract` for clients that want to apply the same rule.
