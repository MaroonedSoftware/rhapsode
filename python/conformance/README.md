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

Every check names the section of [`docs/protocol.md`](../../docs/protocol.md) it comes from. The one
worth understanding is the pair that compare audio with and without a cue or a delivery. Section 8
says an adapter must do exactly one thing honestly, claim only what its loaded variant can actually
perform, and that nothing else checks it. That is still true in general, but the common shape of the
lie is a claim wired to nothing at all, and a claim wired to nothing produces audio identical to the
line without it. This catches that.
