---
---

`rhapsode-engine-tone` clones: a voice's pitch comes from its reference's hash, so every clip makes a different voice, and an unknown voice is `unknown_voice` rather than the default sine. `rhapsode-engine-chatterbox`'s voice `spec` now changes when the reference does, and a re-record replaces the old clip whatever its extension. The conformance suite checks the clone round trip on engines that clone, and that an unknown voice or a voice id that is a path is refused.
