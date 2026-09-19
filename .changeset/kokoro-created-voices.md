---
---

Kokoro makes voices two ways through `POST /engines/kokoro/voices`. A `blend` recipe, `af_bella(2)+af_sky(1)` in Kokoro-FastAPI's syntax, is mixed once and kept under its own id. A `reference` is a style vector, a `.npy` or a Kokoro-FastAPI `.pt` voicepack, which is how its `v0` voices such as `am_v0gurney` come across; a `.pt` is read as data and never unpickled. The capability document says which: `current.cloning.formats` lists what a reference may be, and `current.blending.supported` whether an engine blends. The worker SDK gains an optional `blend_voice` and `reference_formats`, the conformance suite checks a blend's round trip, and the page's Try it offers a blend form and asks each engine for the files it takes.
