# Running one

What an operator needs that the protocol does not say, because it is about this implementation
rather than about the contract.

## Configuration

`rhapsode.config.json` beside the binary, or wherever `RHAPSODE_CONFIG` points.

```jsonc
{
    "server": {
        "port": 8080,
        "host": "::",
        // Comfortably longer than workers.drainGraceMs, because every module's shutdown hook is
        // awaited before the process exits. Equal values make a correct shutdown look hung.
        "shutdownGraceMs": 20000
    },
    "log": { "level": "info" },

    "residency": {
        // One is the right answer for one GPU. Raising it on a card that cannot hold two models is
        // how you turn a queue into an out-of-memory error.
        "maxResidentModels": 1,
        // How long a request for a second engine waits for the first to stop speaking before it is
        // told to try again. At maxResidentModels 1 this is simply a queue.
        "evictionWaitSeconds": 30,
        // Both off by default: they trade a cold start for memory nobody is asking for.
        "idleUnloadSeconds": null,
        "idleTerminateSeconds": null
    },

    "workers": {
        // Keep this short. A unix socket path is limited to about 100 bytes and the failure is an
        // opaque EINVAL at bind time; rhapsode checks the length and refuses with a better message.
        "socketDir": "/run/rhapsode",
        "startupTimeoutSeconds": 60,
        "drainGraceMs": 10000,
        "maxRestarts": 5,
        "restartDecaySeconds": 300
    },

    "management": {
        // Without this, the install routes answer loopback callers only. With it, a caller
        // presenting it as a bearer token is admitted from anywhere. Those routes run pip, so treat
        // this as a root password for the box.
        "token": null
    },

    "install": {
        // Where installed engines get their virtualenvs. Default ~/.rhapsode/venvs.
        "venvDir": "/opt/rhapsode/venvs",
        // Where adapter sources are looked for before the package index. Defaults to the python/
        // directory of the checkout the server is running from, when there is one.
        "sourceDir": null,
        // The interpreter that creates each virtualenv. Default python3.
        "python": "python3"
    },

    "engines": {
        "tone": { "venv": "/opt/rhapsode/venvs/tone" },
        "chatterbox": {
            "venv": "/opt/rhapsode/venvs/chatterbox",
            "autostart": true,
            "env": { "CUDA_VISIBLE_DEVICES": "0" }
        },
        "dia": { "url": "http://gpu-02.lan:9310" }
    }
}
```

An engine entry with a `venv` is local and gets a process; one with a `url` is remote and does not.
That is the only difference, and everything above the transport is the same code.

Each engine gets its own virtualenv. That is the point: one engine's dependency tree cannot break
another's, and a crash takes down a worker rather than the server. The environment a worker is
spawned with is constructed rather than inherited, so it never sees the core's `PYTHONPATH` or
`VIRTUAL_ENV`.

## Installing engines

`pnpm wizard install chatterbox` does it from a terminal, and anything else can do it through the
routes in `docs/protocol.md` § 10. Either way the server does the work, so it has to be running.

What it installs is recorded in `rhapsode.engines.json` beside the config file (or beside wherever
`RHAPSODE_CONFIG` points). The server writes that file and never touches yours. Both are read at
boot and **yours wins** where they name the same engine, so to override something about an
installed engine, such as its `env`, add an entry for it to your config rather than editing the
managed file. An engine you configured by hand cannot be uninstalled through the API: remove it from
your file.

If pip cannot verify a certificate because something on your network intercepts TLS, start the
server with `RHAPSODE_PIP_TRUSTED_HOSTS=pypi.org,files.pythonhosted.org`. It is deliberately not
something a client can ask for.

Uninstalling removes the virtualenv and leaves downloaded weights where the engine put them.
Chatterbox's are in `~/.cache/huggingface`, 9.7 GB for all three variants.

## What to watch

`GET /health` answers while every worker is down and never blocks on one.

```json
{
    "contract": 1,
    "status": "ok",
    "engines": [{ "id": "tone", "process": "up", "model": "loaded", "variant": "plain", "restarts": 0 }],
    "residency": { "resident": 1, "max": 1, "waiting": 0 }
}
```

`residency.waiting` above zero with `blockedBy` set is the case that looks like a hang and is not: at
`maxResidentModels: 1`, a five-minute synthesis on one engine makes a request for another wait. It
is correct, and it is worth an alert threshold rather than a page.

`restarts` climbing is the one to care about. The count decays only after a worker has been up
continuously for `restartDecaySeconds`, so an engine that crashes on every third synthesis climbs
rather than resetting. At `maxRestarts` the engine is reported `failed` and stops being restarted
automatically: a version mismatch or a broken virtualenv does not get better with backoff.

## Logs

One JSON object per line on stdout. A worker's own lines are forwarded with `engine` attached as a
field, so the core's log and a worker's log filter the same way. Lines a worker writes that are not
JSON are passed through at `warn` rather than dropped, because torch, transformers and CUDA all
write warnings the SDK never sees and those are exactly the lines you need when a load fails.

## Formats

`GET /engines/{id}/capabilities` reports `formats`, and it reports what that worker can actually
produce rather than what the protocol defines. `pcm` and `wav` are framed by the SDK itself and are
always available; `mp3`, `opus` and `flac` need ffmpeg, and need an ffmpeg built with `libmp3lame`,
`libopus` and `flac` respectively. Distribution builds routinely ship without libopus, so the check
distinguishes "install ffmpeg" from "build one with the encoder you want", and a `/speak` asking for
a missing format says which.

Installing ffmpeg needs a worker restart to be noticed.

## Two things worth knowing about failure

**A `/speak` that fails mid-stream breaks the connection.** Once a `200` and a `Content-Type` are on
the wire the status cannot be taken back, so an abort is the only honest ending: a clean close would
hand you a short, silent, apparently successful file. A client will see a truncated body and an
error. If it sees a complete short file instead, that is a bug, and it is the one this behaviour
exists to prevent.

**`stream: false` reports failures strictly better.** Everything is still a pre-headers failure, so a
problem that would have torn the connection becomes an ordinary error envelope with a code and a
`retryable` flag. If your client can afford the latency, ask for it.

## Shutting down

`SIGTERM` drains: new requests are refused as `overloaded` (429, retryable), in-flight synthesis
finishes, and the workers are stopped in reverse registration order so nothing is killed out from
under a stream still reading it. `SIGKILL` after the grace period is the backstop.
