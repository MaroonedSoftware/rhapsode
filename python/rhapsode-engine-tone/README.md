# rhapsode-engine-tone

A rhapsode engine with no weights. It makes a tone instead of speech, so that the protocol can be
tested without a model: it loads in microseconds, needs no GPU, downloads nothing, and runs in CI on
every commit.

It is the conformance fixture. Every rule a worker has to follow holds for this engine too, including
two variants that differ the way real builds do (one performs cues and has no dials, the other has
dials and performs no cues), so `rhapsode-conform` has something honest to compare a real engine
against.

```bash
pnpm wizard install tone
```

See [the protocol](https://github.com/MaroonedSoftware/rhapsode/blob/main/docs/protocol.md), § 8.
