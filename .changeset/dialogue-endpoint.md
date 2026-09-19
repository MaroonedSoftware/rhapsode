---
---

`POST /engines/{engine}/dialogue` speaks a conversation in one take, on a variant whose capability document declares `dialogue` with its `maxSpeakers` (protocol.md § 6). Each turn names a speaker, and `voices` maps speakers to voice ids; a speaker with no voice is read in one the engine picks. Cues are stripped per turn, the ceiling is the sum of every turn's text, more speakers than the variant takes is `unsupported`, and a variant that does not declare it answers `unsupported`. The response is `/speak`'s in every other respect. The worker SDK gains `Engine.dialogue`, `DialogueRequest` and `max_speakers`, and declares dialogue wherever an adapter overrides it; the tone engine performs one, the client SDK has `dialogue()`, and the conformance suite checks it where it is declared.
