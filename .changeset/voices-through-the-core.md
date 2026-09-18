---
'@rhapsode/core': minor
---

`POST /engines/{engine}/voices` clones a voice and `DELETE /engines/{engine}/voices/{voice}` removes one, behind the management guard. The upload is streamed to the worker with no copy kept, and refused over 25 MB. Each local worker now keeps its voices in `<workers.voiceDir>/<engine>`, `~/.rhapsode/voices` by default, rather than under the core's working directory.
