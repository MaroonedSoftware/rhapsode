---
---

A worker measures what a load cost and reports it as `WorkerHealth.modelBytes` (`protocol.md` § 3).
`vramBytes` is what the card holds and has always been its capacity rather than its use, so a core
choosing what to evict has been working from a count of models and the assumption that they are all
the same size: Kokoro is 82M parameters and Dia is 1.6B. The SDK takes a device-wide delta across
`load()` and clears it on unload, so an adapter gets the figure for nothing; `rhapsode-worker` gains
an optional `Engine.memory_bytes()` for an adapter that knows the real number, which wins over the
measurement. The measurement is card-wide on purpose, counting the runtime's context and an ONNX or
vLLM allocation nobody attributes to a model, and torch is imported inside the function as
`detect_device` already does, so an ONNX or pure-CPU adapter can still install the SDK. A worker
that cannot measure reports nothing rather than `0`, since a core adding up a card reads zero as a
model that is free, and the conformance suite now checks exactly that.
