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
        // Each local worker keeps its cloned voices in <voiceDir>/<engine>. An engine's own `env`
        // can name RHAPSODE_VOICE_DIR instead. Default ~/.rhapsode/voices.
        "voiceDir": "/var/lib/rhapsode/voices",
        "startupTimeoutSeconds": 60,
        "drainGraceMs": 10000,
        "maxRestarts": 5,
        "restartDecaySeconds": 300
    },

    "management": {
        // Without this, the install routes answer loopback callers only. With it, a caller
        // presenting it as a bearer token is admitted from anywhere. Those routes run pip, so treat
        // this as a root password for the box.
        "token": null,
        // Browser origins, besides this machine's own, whose pages may call the install routes.
        // A page from anywhere else is refused, token or not.
        "origins": []
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

`pnpm wizard install kokoro` does it from a terminal, and anything else can do it through the
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

An engine's weights normally arrive on its first load, which for Chatterbox's `turbo` means a first
`/speak` that waits about 75 seconds on a 3.8 GB download, and for Kokoro's `fp16` 205 MB. `POST /engines/{id}/pull` (or the wizard's
offer to pull) downloads them ahead of time, without loading anything.

Uninstalling removes the virtualenv and leaves downloaded weights where the engine put them.
Chatterbox's are in `~/.cache/huggingface`, 9.7 GB for all three variants. Kokoro's are in
`~/.cache/rhapsode/kokoro`, or wherever `RHAPSODE_KOKORO_WEIGHTS` points. Orpheus's are in
`~/.cache/huggingface` too: 3.5 GB for `q8`, 2.1 GB for `q4`, 6.6 GB for `full`, and 80 MB for
the codec they share.

Kokoro needs Python 3.11 to 3.13. The installer asks uv for one when uv is on the path; without uv it
checks `install.python` first and stops, saying so, when that interpreter is outside the range.

### Orpheus

What an Orpheus install brings depends on the box, because only one of its two backends installs
without compiling anything:

- **Linux x86_64, the server image included: vLLM**, and the `full` build on an NVIDIA card. The
  weights are unsloth's ungated copy, 6.6 GB, so no token is needed. vLLM claims 7 GiB of the card
  when it loads; `RHAPSODE_ORPHEUS_GPU_MEMORY` in the engine's `env`, a fraction of the card, moves
  that.
- **Anywhere else: llama.cpp**, and the `q8` and `q4` builds. On a Mac pip builds it with Metal,
  which needs the Xcode command line tools (`xcode-select --install`).

The catalog's default is `q8`, which a Linux box does not have, so pull `full` by name there:
`POST /engines/orpheus/pull` with `{"variant": "full"}`. A request that names no variant uses
`full` anyway, because the core skips a default the worker does not list.

A Linux box with no NVIDIA card gets no variant it can run. Install the GGUF builds into the
engine's virtualenv by hand, which needs a C++ compiler, then restart the engine:

```bash
~/.rhapsode/venvs/orpheus/bin/pip install 'rhapsode-engine-orpheus[llama]'
```

## The web page

`apps/web` is a page for the same routes: the catalog with both licences, and install, pull and
uninstall with each job's progress as it happens. It is a static app, and it talks to the core
through a proxy on its own origin at `/api`, so the core needs no CORS.

```bash
pnpm dev        # the server on :8080 and the page on http://localhost:8081, proxying /api to it
```

`RHAPSODE_API_TARGET` points the dev server at a core elsewhere. To serve the built page, build it
with `pnpm build` and put `apps/web/dist` behind anything that serves files and proxies `/api`. With
nginx:

```nginx
location ^~ /api/ {
    proxy_pass http://127.0.0.1:8080/;
    # The core believes this only from a proxy on its own machine, and only ever to trust a caller
    # less. Without it, everyone who can reach this page would reach the install routes as local.
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    # An install's events stream stays open while it runs.
    proxy_buffering off;
    proxy_read_timeout 1h;
    # A voice's reference clip may be 25 MB. nginx's default of 1 MB refuses about ten seconds.
    client_max_body_size 26m;
}
location / {
    root /srv/rhapsode-web;
    try_files $uri /index.html;
}
```

The install routes answer the machine the core runs on, so a page opened from another machine shows
the catalog and says installing is only for this one. That is deliberate: the page has no sign-in,
and those routes run pip. If you serve the page under a name of your own, such as
`https://rhapsode.home.arpa`, add that origin to `management.origins`, or the core will refuse the
page's requests as coming from a site it does not know.

## Docker

No checkout, no Node and no build: `compose.yaml` is the whole install, and pulls the published
image.

```bash
mkdir rhapsode && cd rhapsode
curl -fsSLO https://raw.githubusercontent.com/MaroonedSoftware/rhapsode/main/compose.yaml
docker compose up -d     # the server on 127.0.0.1:8080, the page on http://localhost:8081
```

One image, `ghcr.io/maroonedsoftware/rhapsode`. Each release publishes it for amd64 and arm64,
tagged with its version, its minor line (`0.1`) and `latest`, and `RHAPSODE_VERSION` pins one. It
shares the version every package carries (`docs/protocol.md` § 9), so image 0.3.0 is core 0.3.0, and
it installs the engines that were released with it. `docker compose pull` followed by
`docker compose up -d` upgrades in place, keeping both volumes.

From a checkout, `compose.build.yaml` builds it from `docker/Dockerfile` instead, tagged `local` so
that a build never passes for a release. It is what the Docker smoke test runs:

```bash
docker compose -f compose.yaml -f compose.build.yaml up -d --build
```

The image is the whole install: the core, and the page behind nginx in the same container, proxying
`/api` as above. The entrypoint starts nginx beside the server and stops it only once the server has
drained. `RHAPSODE_API_PORT` and `RHAPSODE_WEB_PORT` move the published ports.

It was two containers, and one is less to run for nothing lost: unraid needed a network and a
second template so the page could find the server, the token crossed between them through a file in
`/config`, and nginx had to re-ask Docker's DNS or lose the core whenever its container was
recreated. The core still serves no page of its own (protocol.md § 12). nginx is a second process
beside it, reaching it over loopback like any other proxy on the same machine.

Coming from the two-container compose, the old page container still holds port 8081, so replace it
along with the server:

```bash
docker compose up -d --remove-orphans
```

### Two volumes

| Mount     | What                                                        | Where in it                            |
| --------- | ----------------------------------------------------------- | -------------------------------------- |
| `/config` | the config, and `rhapsode.engines.json` beside it           | `rhapsode.config.json`                 |
|           | cloned voices                                               | `voices/<engine>`                      |
| `/data`   | each engine's virtualenv                                    | `.rhapsode/venvs/<engine>`             |
|           | the Python interpreters those virtualenvs run on            | `.local/share/uv/python`               |
|           | weights: Chatterbox's Hugging Face cache, Kokoro's own      | `.cache/huggingface`, `.cache/rhapsode` |
|           | pip's and uv's download caches                              | `.cache/pip`, `.cache/uv`              |

`/config` is small and is the one to back up: a cloned voice cannot be downloaded again. `/data` is
tens of GB with Chatterbox and all of it can be. `/data` is the container's `HOME`, which is the
whole mechanism: everything an engine downloads already lands under `HOME`, so none of it needs to
know it is in a container.

The two are joined in one place: `rhapsode.engines.json` names virtualenvs in `/data`. Lose `/data`
and those engines stay listed but fail to start until they are installed again, from the page or
the wizard. Lose `/config` and the downloads survive, but the engines and voices are forgotten.

On first boot, with an empty `/config`, the server writes a config there and never touches it
again. It differs from an empty one in four things: `install.sourceDir` names the Python sources in
the image, `install.python` is `3.12`, `workers.voiceDir` is `/config/voices`, and there is a
generated `management.token`. Leave `server.port` at 8080, the port compose publishes.

### No Python in the image

A virtualenv is a directory of links to the interpreter that made it. Were that `/usr/bin/python3`
in the image, every engine in `/data` would break on the first base image that ships a different
minor version, and reinstalling Chatterbox is several GB of torch. So the image has `uv` and no
Python, and uv fetches an interpreter into `/data` beside the virtualenvs that use it: 3.12 by
default, or whatever an engine's range asks for, such as Kokoro's 3.13.

The cost is that the first install fetches about 30 MB from GitHub as well as packages from PyPI,
so a network that allows one and not the other fails there. `install.python` can name an
interpreter you mount in instead.

### Installing from the page

A published port is never loopback to the core: a request through one arrives from Docker's bridge.
So the install routes answer only the management token, and nginx presents it on the page's behalf.
It follows an edit to the token once the container restarts. A token that is not a valid bearer
token, by RFC 6750's alphabet, is not presented and the log says so, since nginx would read a `$` or
`"` in it as its own syntax.

That makes the page's port the key to the install routes, which run pip, and it is why compose
publishes both ports on `127.0.0.1` only. Publishing the page to your LAN gives everyone on it that
key. The API port without the page is safe to widen: installs there still need the token.

The wizard installs through the page's proxy, with no token on the host:

```bash
pnpm wizard install kokoro --server http://127.0.0.1:8081/api
```

`HF_TOKEN`, `CUDA_VISIBLE_DEVICES` and anything else an engine should see go in that engine's `env`
block in `/config/rhapsode.config.json`, not in the container's environment, because a worker's
environment is constructed rather than inherited.

### GPUs

```bash
curl -fsSLO https://raw.githubusercontent.com/MaroonedSoftware/rhapsode/main/compose.gpu.yaml
docker compose -f compose.yaml -f compose.gpu.yaml up -d
```

The image has no CUDA of its own and needs none: the torch wheels Chatterbox installs from PyPI
carry the CUDA runtime. What cannot come with them is the driver, which has to match the host's
kernel module. So the host needs the NVIDIA driver and the NVIDIA Container Toolkit, and the
container has to ask for the GPU, which is what `compose.gpu.yaml` adds. The toolkit then mounts the
driver in for every process in the container, workers included, whatever their constructed
environment leaves out.

On unraid, with the Nvidia-Driver plugin installed, the server container asks with
`--runtime=nvidia` in Extra Parameters and a `NVIDIA_VISIBLE_DEVICES` variable, set to `all` or to a
GPU's UUID from the plugin's page. The image already sets the `NVIDIA_DRIVER_CAPABILITIES` that
style also needs, because it is not a CUDA image and nothing else would.

Either way, `GET /engines/chatterbox/capabilities` says `"device": {"type": "cuda", ...}` once it
worked. `cpu` there means the container cannot see the GPU, and Chatterbox will run, slowly, anyway.

The image carries `gcc` for the same reason it carries no CUDA: vLLM, which Orpheus's `full` build
runs on, brings CUDA in its wheels, but Triton under it compiles a small C helper at run time and
fails every load without a C compiler. It is C only; nothing in the image compiles C++ or CUDA.

Measured on an RTX 4070 Ti SUPER through `compose.gpu.yaml`: installing Chatterbox took 93 seconds
and 6.2 GB in `/data`, the first `turbo` sentence 50 seconds while 3.8 GB of weights arrived, and
the next 0.45 seconds, holding 3.1 GB of VRAM. After the containers were replaced, the first
sentence took 9 seconds, loading from the volume with nothing fetched.

Docker's default ten-second stop kills a worker before the core has drained it. Compose waits 30
seconds; with `docker run`, pass `--stop-timeout 30`.

### unraid

One container, from `ghcr.io/maroonedsoftware/rhapsode`: `/config` to `/mnt/user/appdata/rhapsode`,
`/data` to a share such as `/mnt/user/rhapsode`, `--user 99:100` so both are written as unraid's own
`nobody:users`, ports 8080 and 8081, and `--stop-timeout 30` in Extra Parameters.

Opened as `http://tower:8081` rather than from the server itself, the page's origin is not loopback,
so add it to `management.origins`. That is also the moment the page reaches the install routes from
the LAN, which the section above describes the cost of.

## Voices

A cloned voice is a reference clip in the engine's voice store, `<workers.voiceDir>/<engine>`
(`~/.rhapsode/voices/<engine>` by default), beside a `.labels.json` the SDK keeps. The core keeps
no copy and no list of its own. Back that directory up if the voices matter; deleting a clip there
deletes the voice. Cloning and deleting answer this machine only, like installing, and a clip is
limited to 25 MB. `docs/protocol.md` § 7 has the rules.

## OpenAI clients

`POST /v1/audio/speech` takes OpenAI's speech request, so a client written for OpenAI works once it
is pointed at this server. Give it `http://<host>:8080/v1` as the base URL and any API key, which is
ignored. `model` is the engine, or `engine:variant`, and `voice` is one of that engine's voice ids:

```bash
curl -X POST localhost:8080/v1/audio/speech \
  -H 'content-type: application/json' \
  -d '{"model":"chatterbox:turbo","input":"Right, that was The Verve Pipe.","voice":"narrator_02","response_format":"wav"}' \
  --output line.wav
```

Three things surprise people. `tts-1` and `alloy` are refused rather than mapped to something here,
so set the client's model and voice to real ones, or clone a voice with the id the client insists
on. Leaving `response_format` out asks for `mp3`, as OpenAI does, and that needs ffmpeg with
`libmp3lame` on the engine's box. And `instructions`, or a `speed` other than 1, is refused by an
engine with no dial to carry it, instead of being quietly ignored. `docs/protocol.md` § 11 has the
rules and the reasons.

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
