# rhapsode-conform

Point it at a worker and it says whether that worker is one.

```bash
rhapsode-conform unix:/run/rhapsode/workers/chatterbox.sock
rhapsode-conform tcp:127.0.0.1:9310
rhapsode-conform http://gpu-02.lan:9310
```

It talks HTTP and nothing else, so a worker on a socket, a worker on another machine, and a worker
written in a language this project has never heard of are all the same thing to it. The exit code is
the verdict, which is the whole interface for wiring it into your own CI.

Every check names the section of
[`docs/protocol.md`](https://github.com/MaroonedSoftware/rhapsode/blob/main/docs/protocol.md) it
comes from. The one worth understanding is the pair that compare audio with and without a cue or a
delivery. Section 8 says an adapter must do exactly one thing honestly, claim only what its loaded
variant can actually perform, and that nothing else checks it. That is still true in general, but
the common shape of the lie is a claim wired to nothing at all, and a claim wired to nothing
produces audio identical to the line without it. This catches that.

Only with the seed held fixed, though. A model that samples produces different audio on every call,
so without a seed "the audio changed" is true whether or not anything was performed, and a check that
cannot fail would be reported as one that had succeeded. So the suite first asks, per variant,
whether the same seed and text reproduce the same audio. Where they do, the comparisons run with that
seed. Where they do not, which § 6 allows, the comparisons are reported as `skip` rather than `ok`,
and the summary says so on its own line: nothing failed, but the checks about whether a claimed cue is
performed could not be decided, so listen to those yourself. `--strict` turns undecided into a
failing exit code, for a CI that needs the honesty checks decided.
