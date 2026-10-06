# rhapsode-worker

The SDK an engine author subclasses. You write one class; the SDK handles the socket, the handshake,
the error taxonomy, format encoding from your native PCM, and the load-retry rules.

See [`docs/protocol.md`](https://github.com/MaroonedSoftware/rhapsode/blob/main/docs/protocol.md) § 8.

## What a first load costs, and who pays it

Two optional declarations move the slow part of a first load from the first request to install
time. Both are for the operator's benefit: a caller waiting on one utterance cannot tell a long
first load from a hang.

**Override `fetch(variant)` if your weights are downloaded.** It downloads them to wherever your
engine keeps them, without loading anything. An install with `?pull=<variant>` and a pull call it,
and neither takes a residency slot. Chatterbox's `turbo` is 3.8 GB and took about 75 seconds on a
first load without it. Leave it alone if your weights ship inside your package or you have none.

**Declare `Variant(compiles=True)` if your runtime compiles on its first load.** That means a cache on
disk that every later load reads instead of compiling again, such as vLLM's Inductor compile or
`torch.compile` with a persistent cache. An install that pulls such a variant then loads it once
and unloads it (its `warm` step), a reinstall does it again after an upgrade, and
`POST /engines/{id}/warm` does it on request. Orpheus's `full` declares it: its first load took
35 seconds and held 8.05 GB, every load after it 12 seconds and 7.26 GB.

```python
def variants(self) -> dict[str, Variant]:
    return {"full": Variant(cues=CUES, compiles=True), "q8": Variant(cues=CUES)}
```

Declare it only where it is true. A warm takes a residency slot as a `/speak` would, so it can evict
another engine's idle model, and a variant that declares `compiles` without compiling makes every
install of it pay a load for nothing. Declare it per variant: Orpheus's GGUF builds run on llama.cpp,
which compiles nothing, and do not declare it. Before you do, check where the cache lands. The core
gives your worker the server's `HOME`, which in the server image is the `/data` volume, and its
`TMPDIR`, which a recreated container loses: vLLM's cache is under `~/.cache/vllm` and survived a
recreate, while a cache under `/tmp` would compile from cold after every recreate, and every image
upgrade is one.
