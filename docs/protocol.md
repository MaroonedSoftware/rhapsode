# The worker protocol and the capability document

The contract, written before the code.

**Rhapsode** is a multi-engine speech server: one HTTP contract, many TTS models behind it, each in
its own process. `MaroonedSoftware/rhapsode`, published as `ghcr.io/maroonedsoftware/rhapsode`, with
the engine SDK on PyPI as `rhapsode-worker`. A rhapsode was a performer who recited written verse
aloud, which is the job description.

Two audiences read this file and they need different things. A **client author** needs the public
API and the capability document, and should never learn that workers exist. An **engine author**
needs the worker protocol and the Python SDK, and should never learn that the core is TypeScript.
The seam between them is the point of the design, so each half is written as if the other were
somebody else's project.

Every rule below that looks arbitrary is one somebody already paid for, and says so.

---

## 1. The one shape

**A worker speaks the engine-scoped subset of the public API.** There is no second protocol.

| Public API | Worker |
| --- | --- |
| `GET /engines` | (the core aggregates) |
| `GET /engines/{id}/capabilities` | `GET /capabilities` |
| `GET /engines/{id}/voices` | `GET /voices` |
| `POST /speak` (with `engine`) | `POST /speak` |
| `GET /health` | `GET /health` |
| (core policy) | `POST /load`, `POST /unload`, `POST /terminate` |

This is the single decision everything else falls out of, and it buys four things:

- An engine author develops and tests against the **worker alone**, with curl. The core is not a
  dependency of writing an adapter.
- A **remote worker is a URL**. Local and remote are the same code path, not two, so "engines on
  another box" needs no new protocol and no new bugs.
- The core is a router, a registry and a supervisor. It holds no engine knowledge, which is what
  keeps the "core never imports torch" rule structural rather than aspirational.
- One shape to learn, document and version.

**Transport: HTTP over a Unix domain socket by default, TCP when configured.** Same protocol either
way. The socket avoids port allocation in the common case and dies with its directory; TCP is what
a remote worker uses. Chunked transfer encoding is what makes streaming audio work without inventing
a framing layer, which is the reason this is HTTP and not a pipe with length-prefixed messages.

---

## 2. Worker lifecycle

### Spawn

The core starts a worker with three environment variables and nothing else:

```
RHAPSODE_WORKER_LISTEN=unix:/run/rhapsode/workers/chatterbox.sock   # or tcp:127.0.0.1:0
RHAPSODE_WORKER_ENGINE=chatterbox
RHAPSODE_WORKER_CONTRACT=1
```

`RHAPSODE_WORKER_CONTRACT` is the highest contract the core speaks, not a demand. The worker answers
at the highest version it supports that is not above it, and says which in the handshake. §9 has the
rest.

### Handshake

**The worker prints exactly one JSON line to stdout when it is bound and ready, and nothing else to
stdout ever.** Logs go to stderr as JSON lines, and the core forwards them into its own logger with
the engine id attached.

```json
{"ready":true,"contract":1,"engine":"chatterbox","listen":"unix:/run/rhapsode/workers/chatterbox.sock"}
```

A line rather than a poll loop because polling is how you end up with TTS-WebUI's 120-second socket
wait: a worker that died on an import error is indistinguishable from one that is slow to start, and
the operator waits two minutes to find out. A worker that exits before printing the line has failed
to start, and its stderr is the error message.

Stdout is reserved for this one line so that a print statement in somebody's adapter cannot corrupt
the handshake. Say so loudly in the SDK docs, and have the SDK capture `sys.stdout` and redirect it
to the log stream after the handshake, so the rule cannot be broken by accident.

### Stop

`SIGTERM` means drain: refuse new requests as `overloaded`, finish what is in flight, exit 0. The
error table in § 6 is what fixes the status, and it says `429` and retryable, which is the answer
this case wants: a request refused by a draining worker is one the core should send somewhere else
or send again, not one it should write off. (This paragraph said `503` and the table said `429`. The
table wins, because a caller reads the code and the `retryable` flag rather than the prose.) The
core sends `SIGKILL` after a grace period it owns. `POST /terminate` (§3) is the same sequence asked
for over HTTP rather than signalled, and is what reclaims a card from a worker the core cannot
signal.

An exit the core did not ask for is a crash, and the core restarts it with backoff, holding the
restart count against it. An exit that follows a `SIGTERM` or a `/terminate` is not, however it is
timed: a worker that finishes draining a second after the core stopped waiting has done its job.

---

## 3. Process residency and model residency are different things

This distinction is load-bearing and is the thing most servers in this space get wrong.

- **A worker process** costs tens of megabytes. Starting one is cheap.
- **A loaded model** costs gigabytes of VRAM. Loading one is expensive and exclusive.

So the state machine is per worker:

```
down → starting → up(unloaded) → loading → up(loaded)
                       ↑                        |
                       +------- unloading ------+
```

`GET /health` reports both:

```json
{"process":"up","model":"loaded","variant":"turbo","device":"cuda:0","vramBytes":4831838208}
```

### Three rules, each paid for

**`POST /speak` loads on demand.** If the model is not resident, `/speak` loads it and then speaks.
It does not fail with "no model loaded" and it does not require the client to call `/load` first.
The alternative was measured on a running station: the client ended up calling a model-info endpoint
before *every single synthesis* to find out whether the previous request's unload had emptied the
server, because nothing else would notice. That is a round trip per utterance to ask a question the
server already knows the answer to.

**A failed load unloads before retrying, exactly once.** A CUDA OOM strands its own partial
allocations. 3.5 GiB was measured stranded on a 16 GiB card, so an immediate retry throws itself at
a GPU it just filled. Unload-then-load-once covers the common case of a card that was briefly full
and has since freed up. This belongs in the SDK so every adapter gets it without knowing about it.

**Unloading does not reclaim everything; terminating does.** An unload reclaims roughly 70% of what
the model held, because the graphics runtime keeps the rest until the process exits. So the core
needs both verbs and must know they differ: `unload` for "I may want this again shortly",
`terminate` for "I need the card back". A residency manager with only `unload` will slowly lose a
card to nothing.

**Which is why `terminate` is a worker verb and not a core one.** The obvious implementation is for
the core to signal the process it spawned, and that works for exactly as long as every worker is
local. A remote worker (§1) is a URL on somebody else's box, so a core that terminates by signalling
silently degrades to `unload` over TCP, and the 30% it cannot reclaim goes unreported.
`POST /terminate` means drain and exit 0: the worker ends its own process, and whatever supervises
it locally restarts it. The core still sends the signal to a local worker that has stopped
answering, but the verb is what it reaches for first, and it is the only thing that works in both
places.

### Core policy, not worker policy

The worker obeys; the core decides. Default policy, all configurable:

- `maxResidentModels` (default 1, which is the right answer for one GPU)
- LRU eviction when a `/speak` needs a model and the budget is full
- `idleUnloadSeconds` (default off, because it trades a cold start for memory nobody is asking for)
- `idleTerminateSeconds` (default off)

Putting this in the core rather than in each worker is what stops every adapter author reinventing
an idle timer, and it is the only component that can see the whole card.

---

## 4. The capability document

This is the product. Everything else is plumbing that three other projects already have.

```http
GET /capabilities
```

```json
{
  "contract": 1,
  "engine": {
    "id": "chatterbox",
    "displayName": "Chatterbox",
    "adapterVersion": "0.3.1",
    "upstreamVersion": "0.1.4"
  },
  "license": {
    "code": "MIT",
    "weights": "MIT",
    "weightsCommercialUse": true,
    "notes": "https://github.com/resemble-ai/chatterbox"
  },
  "device": { "type": "cuda", "name": "NVIDIA GeForce RTX 4090", "vramBytes": 25757220864 },
  "current": {
    "variant": "turbo",
    "cues": ["laugh", "chuckle", "sigh", "gasp", "cough", "clear throat", "sniff", "groan"],
    "deliveries": [],
    "dials": {},
    "languages": ["en"],
    "maxCharacters": 4096,
    "cloning": { "supported": true, "referenceSeconds": [5, 10], "formats": ["wav", "mp3"] },
    "streaming": { "supported": true, "granularity": "chunk" },
    "nativeFormat": { "encoding": "pcm_s16le", "sampleRate": 24000, "channels": 1 }
  },
  "variants": {
    "turbo":        { "cues": ["laugh", "..."], "deliveries": [], "dials": {} },
    "original":     { "cues": [], "deliveries": ["hushed", "frantic"],
                      "dials": { "exaggeration": {"min":0,"max":2,"default":0.5},
                                 "cfgWeight":    {"min":0,"max":1,"default":0.5} } },
    "multilingual": { "cues": [], "deliveries": ["hushed", "frantic"], "dials": { "...": {} },
                      "languages": ["en","fr","de","es","..."] }
  },
  "formats": ["wav", "mp3", "opus", "flac", "pcm"]
}
```

### Why `current` and `variants` are separate, and why this is the hardest part

**An engine's capabilities can depend on which build is loaded.** Chatterbox is the proof: the
`turbo` build performs the paralinguistic tags and silently discards the expressiveness dials
(upstream logs that it is ignoring them), while `original` and `multilingual` are the other way
round. So on that engine you get cues or dials and never both, and which one is a fact about the
weights that are resident **right now**.

A single flat capability list cannot express that, and a client that assumes one will send dials
that vanish without a word. The two-level document is what lets a client ask "what can I do with
what is loaded" and "what would I get if I asked for a different variant" as separate questions.

Engines with one build report a single variant and `current` mirrors it. The shape costs them
nothing.

**`current` is absent when no model is resident**, because a worker in `up(unloaded)` has nothing to
describe and an invented answer is worse than no answer. `variants` is always present, so the
question "what could this engine do" is always answerable and only "what can it do right now" goes
away. A client that reads `current` unconditionally will find this on the first request after a
restart, which is the cheapest possible time to find it.

So nothing in the core may depend on `current`. It resolves the **effective variant** first, from
the request's `variant` if it named one, from the resident variant if one is loaded, and from the
engine's default otherwise, then reads `variants[effective]`. That rule is total, and it gives the
same answer as `current` in every case where `current` means anything. It also covers the case the
two-level document exists for: a request that names a variant which is not the one loaded, where
`current` describes weights that are about to be evicted.

### `license` carries code and weights separately

The weights licence is the one that package metadata never reveals, and it is the one that decides
whether a commercial user may ship the thing. Apache-2.0 inference code over research-only weights
is a real and common combination; Breeze TTS 2 is exactly that. A licence scanner reads the package
and reports Apache-2.0, and it is wrong in the way that matters.

So the adapter declares both, by hand, and `GET /engines` surfaces them. Nobody else in this space
does this, and for anyone using the server commercially it is the most useful field in the document.
The catalog entry for an engine carries the same two fields, so the licence is visible **before**
install, not after.

---

## 5. The standard vocabulary

The whole reason a client can stay engine-agnostic.

### Cues

Things a speaker does that are not words. They ride **inside the text**, written `[laugh]`, because
a laugh happens at a place in a sentence and a separate field would have to invent a way to say
where.

```
laugh  chuckle  sigh  gasp  cough  clear throat  sniff  groan
```

A closed set. The engine translates: `(laughs)` for Dia, `[laugh]` for Chatterbox turbo, nothing at
all for Piper.

**The core strips every cue the loaded variant does not claim, before dispatch.** This rule is worth
more than it looks: it means an engine that implements no cues never sees one, and the failure where
an engine reads the word "laugh" out loud cannot happen. Claiming a cue you cannot perform is the
only way to break it, which makes the honesty requirement on adapters exactly one line long.

A removal closes the space it leaves behind, so `word [laugh] word` does not render with a double
space that every consumer would have to know to tidy.

### Deliveries

How a whole line is read. Two, and there is deliberately no word for "ordinary":

```
hushed  frantic
```

A request with no delivery is the voice's own ordinary reading, which is what nearly every line
should be. A third word meaning "ordinary" would be a second way to ask for nothing, and would key
a second cache entry for identical audio.

**A word and not a number.** `exaggeration: 0.9` means something to one family of models and nothing
to the next, so a client that sent it would be tied to the engine it was written against, which is
the thing this whole document exists to prevent. The numbers live in `dials`, per engine, and the
adapter is what turns a word into them.

**Translate relative to the voice, not to a fixed point.** A voice that is intense at rest should
still be more intense than its neighbours when hushed. An adapter that hard-codes `exaggeration =
0.2` for hushed has thrown away the voice's own character.

Widen this list only when two engines can both perform the new word. One engine's feature is a
`dial`, not a delivery.

---

## 6. Speaking

```http
POST /speak
Content-Type: application/json
```

```json
{
  "text": "Right, that was The Verve Pipe. [laugh] Nobody warned me about that intro.",
  "voice": "narrator_02",
  "variant": "turbo",
  "format": "opus",
  "delivery": "hushed",
  "params": { "exaggeration": 0.7 },
  "seed": 20260917,
  "stream": true
}
```

| Field | Notes |
| --- | --- |
| `text` | Required. Cues already stripped by the core to what this variant claims. |
| `voice` | Engine-scoped id from `GET /voices`. Absent means the engine default. |
| `variant` | Absent means whatever is loaded, or the engine's default if nothing is. |
| `format` | From `capabilities.formats`. The **response's** `Content-Type` is authoritative. |
| `delivery` | Only ever one the effective variant claimed; the core drops the rest. |
| `params` | Against the effective variant's `dials` (§4). Unknown keys are refused, not ignored. |
| `seed` | Optional. Reproducibility for engines that can. |
| `stream` | `true` streams chunked; `false` buffers and sets `Content-Length`. |

Response: `200`, `Content-Type: audio/opus`, chunked.

`X-Rhapsode-Duration-Ms` is an ordinary **header** when `stream: false`, because the duration is
known before the headers go out, and a **trailer** when `stream: true`, because it is not. Treat the
trailer as best effort and never require it: `fetch` exposes no trailer API in Node or in a browser,
so only a client built on a raw HTTP library can read one. A client that needs the duration on every
response should ask for `stream: false`.

One note on the opus label, because it will look like a bug to somebody: what goes on the wire is
Ogg-encapsulated Opus, for which `audio/ogg; codecs=opus` is the precise answer. `audio/opus` is
what this contract says, it is what every client in this space already sends and accepts, and the
response's own `Content-Type` is authoritative in any case.

### Unknown keys in `params` are refused

The tempting alternative is to ignore them, and it is wrong for the same reason a silently discarded
dial is wrong: the client believes it asked for something. A `400` naming the key is a bug report
delivered to the right person in under a second.

### Failing after the headers have gone

This is the one that bites, and it needs saying in the spec rather than being discovered per client.

Once a `200` and a `Content-Type` are on the wire, the status cannot be taken back. A worker that
fails mid-stream **must abort the connection** rather than close it cleanly, so the core sees a
truncated body rather than a short successful one.

The core additionally applies a floor: **a body under 256 bytes is not audio**, whatever the status
said. This exists because a server answering `200` with a JSON complaint about an unknown voice
produces a segment that airs as a click, and the only place to notice is at the end of the stream.
The check belongs at the end, not on the first chunk, because a short error body can arrive in
several pieces and "was any of this plausibly audio" is only answerable once it stops.

**The floor behaves differently in the two modes, and that is deliberate.** With `stream: true` the
headers are long gone by the time the count is known, so a body under the floor is an abort and the
client cannot be told why. With `stream: false` the core has the whole body before it writes
anything, so the same failure is an ordinary error envelope with a code and a `retryable` flag.

Which is the general rule and worth stating once: **`stream: false` reports failures strictly better
than `stream: true` does**, because every failure is still a pre-headers failure. Streaming buys
first-byte latency and pays for it in diagnosis. A caller rendering a file rather than feeding a
player should ask for `stream: false` and will get a better error the day something breaks.

### Errors

```json
{ "error": { "code": "unknown_voice", "message": "no voice \"narrator_99\"", "retryable": false } }
```

| Code | HTTP | Retryable | Meaning |
| --- | --- | --- | --- |
| `bad_request` | 400 | no | Malformed, or a `params` key the variant does not have |
| `unknown_engine` | 404 | no | Not in `GET /engines`. Core only; a worker is one engine |
| `unknown_voice` | 404 | no | Not in `GET /voices` |
| `unsupported` | 422 | no | A format, language or feature this variant does not do |
| `model_unavailable` | 503 | **yes** | Loading, evicted, or a load that ran out of time |
| `oom` | 503 | **yes** | Out of device memory |
| `overloaded` | 429 | **yes** | Draining, or at the concurrency limit |
| `internal` | 500 | no | The adapter threw |

**`retryable` is a field and not something the client infers from the status.** The distinction that
matters is between "this request was wrong" and "this request was fine and the server was not", and
a caller that conflates them either retries a permanent failure forever or discards work that would
have succeeded on the next pass. A cold start that ran out of its budget is `model_unavailable`, and
a client that understands that keeps the job rather than writing it off.

---

## 7. Voices

```http
GET /voices
```

```json
[
  {
    "id": "narrator_02",
    "label": "Narrator 02",
    "description": "Cloned from narrator_02.wav",
    "spec": "narrator_02@turbo",
    "tags": ["cloned", "en"],
    "previewUrl": "/voices/narrator_02/preview"
  }
]
```

**`spec` is an opaque token that changes whenever the rendering would.** Clients key cached previews
on it. The reason it exists rather than clients keying on `id`: the id is exactly the part that does
*not* change when somebody edits what is under it, so a remapped voice served its old preview
forever, and the only fix that works is a token the engine mints. Treat it as opaque; never parse it.

**`previewUrl` is worker-scoped, and the core rewrites it.** The worker knows nothing about engine
ids in paths, so it answers `/voices/{id}/preview`, which is correct on its own socket and a `404`
to anybody who followed it from the public API. The core rewrites each one to
`/engines/{engine}/voices/{id}/preview` on the way out. This is the only field the core edits while
proxying, and the only reason it does is that the worker cannot know its own prefix. A client should
follow the URL it was given and never build one.

Cloning, where the variant supports it:

```http
POST /voices
Content-Type: multipart/form-data
  id=narrator_03  label="Narrator 03"  reference=@clip.wav
DELETE /voices/{id}
```

The worker owns its voice store. The core does not proxy files around or keep a shadow registry,
because two registries is one more than the number that can be right.

---

## 8. The Python worker SDK

An adapter author installs one package, writes one class, and never learns what the core is written
in. If that is not true, the extension model is decoration and you will write every engine yourself.

```python
from rhapsode_worker import Engine, Capabilities, Variant, Voice, SpeakRequest, NativeFormat, serve

class ChatterboxEngine(Engine):
    id = "chatterbox"
    display_name = "Chatterbox"
    license = dict(code="MIT", weights="MIT", weights_commercial_use=True)

    # The SDK encodes. Yield PCM and stop thinking about mp3.
    native_format = NativeFormat(encoding="pcm_s16le", sample_rate=24_000, channels=1)

    def variants(self) -> dict[str, Variant]:
        return {
            "turbo": Variant(cues=ALL_CUES, deliveries=[], dials={}),
            "original": Variant(
                cues=[],
                deliveries=["hushed", "frantic"],
                dials={"exaggeration": (0.0, 2.0, 0.5), "cfgWeight": (0.0, 1.0, 0.5)},
            ),
        }

    def load(self, variant: str) -> None:
        self.model = ChatterboxTTS.from_pretrained(variant, device=self.device)

    def unload(self) -> None:
        del self.model

    def voices(self) -> list[Voice]:
        return [Voice(id=p.stem, label=p.stem, spec=f"{p.stem}@{self.variant}")
                for p in self.voice_dir.glob("*.wav")]

    def speak(self, req: SpeakRequest) -> Iterator[bytes]:
        yield from self.model.stream(req.text, audio_prompt_path=self.path_for(req.voice),
                                     **self.dials_for(req))

serve(ChatterboxEngine())
```

### What the SDK does so no adapter has to

- Binds the socket, prints the handshake line, captures stray `stdout`, frames logs as JSON on
  stderr.
- Serves `/health`, `/capabilities`, `/voices`, `/load`, `/unload`, `/terminate` and `/speak`.
  `capabilities()` is assembled from `variants()`, `native_format`, `license` and the detected
  device, and `current` is omitted entirely while nothing is loaded.
- **Encodes.** The engine yields its native PCM; the SDK produces wav, mp3, opus, flac or raw
  through ffmpeg. Without this, every adapter reimplements format conversion and they all do it
  differently. This is the single largest reduction in adapter burden in the design.
- **Applies the unload-then-load-once retry** around `load()`, so the OOM lesson is free.
- Maps exceptions onto the error taxonomy, with `retryable` set correctly, and aborts the connection
  rather than closing it cleanly when `speak()` raises mid-stream.
- Enforces `maxCharacters` and validates `params` against the declared dials before `speak()` is
  called, so an adapter never receives a request it did not declare support for.
- Serialises requests by default. One model, one utterance at a time is the correct default for a
  GPU; an engine that can genuinely batch sets `concurrency > 1` and takes responsibility.

### What an adapter must do honestly, and it is only one thing

**Claim only what the loaded variant can actually perform.** Every guarantee in this document rests
on that and nothing else checks it.

---

## 9. Versioning

`contract` is an integer in the handshake, in `/capabilities`, and in the public API.

- Changes are **additive only** within a major. New optional fields, new enum members at the end.
- The core offers its own maximum in `RHAPSODE_WORKER_CONTRACT` at spawn.
- The worker answers at the highest version it supports that is not greater than the offer, and
  reports that number as `contract` in its handshake line and in `/capabilities`.
- If the offer is below everything the worker supports, the worker exits non-zero before printing a
  handshake, naming both numbers on stderr.
- The core refuses a worker whose reported `contract` exceeds its own, with a message naming both.
- Clients ignore fields they do not know, and must not fail on an unrecognised cue or dial name.

The negotiation is one-sided on purpose: the core states a ceiling and the worker picks under it.
The alternative, both sides declaring a range and meeting in the middle, needs a range on the wire,
and there is nowhere to put one that an old core would understand. A single integer in each
direction is enough because the only question that has ever needed answering is "can you speak the
version I speak", and additive-only evolution means the answer is yes for every version at or below
the offer.

The core and its workers ship separately, so they **will** disagree in the field. Designing for that
on day one costs about forty lines. Retrofitting it costs a client that sniffs your OpenAPI document
to work out what you accept, which is a real thing a real client had to do against a real server, and
is the specific future this section exists to prevent.

---

## 10. Deliberately not in v1

Named so that nobody has to guess whether they were forgotten.

- **STT.** A different problem wearing a similar hat. Say no once, in the README.
- **Multi-speaker dialogue.** Dia wants `[S1]`/`[S2]` alternation and produces a two-hander in one
  pass, with overlaps that stitching separate takes cannot make. It does not fit a `voice` field and
  half-designing it now would put a bad shape in the contract. Open question, section 11.
- **Word timestamps.** Wanted, cheap enough as an optional sidecar response, and not worth blocking
  v1. Leave room: a `X-Rhapsode-Timings-Url` header or a `timings` field in a multipart response.
- **Batching.** Adapters declare `concurrency` and that is the whole of it for now.
- **A UI.** The gap this project fills is that everything else has one.

## 11. Open questions

1. **Dialogue.** Does `text` grow a structured form (`[{voice, text}, ...]`), or does a dialogue
   engine expose a second endpoint? The first pollutes every engine's request shape; the second
   splits the API. Leaning towards a second endpoint declared in capabilities, so engines that do
   not do dialogue are unaffected.
2. **Does the core ever hold audio?** Buffering enables retry-on-truncation and content-addressed
   caching; streaming through means constant memory. Probably: stream through by default, buffer
   only when `stream: false` was asked for.
3. **Voice namespacing across engines.** A station voice that means "the same person" on three
   engines is a client concern, not this server's. Resisting it is probably right, and is worth
   writing down as a decision rather than leaving as an omission.
4. **In-process ONNX engines.** Piper, Kokoro and Supertonic are ONNX, and `onnxruntime-node` means
   the core could run them with no Python and no subprocess. That is a much better first five
   minutes for a new user. It needs a second adapter interface inside the core, which is a real cost
   against a real benefit. Decide before v1, because it changes what "engine" means in the registry.
5. **Where the core lives.** `MaroonedSoftware` already publishes ServerKit and ContractKit, which
   the core builds on, so the provenance line writes itself. Open only on whether the Python worker
   SDK ships from the same repository or its own: same repo keeps the protocol and both of its
   implementations in one place and one commit, and separate repos let the SDK version on its own
   cadence. Leaning towards one repo until the SDK has outside users.
