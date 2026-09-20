# The worker protocol and the capability document

The contract, written before the code.

**Rhapsode** is a multi-engine speech server: one HTTP contract, many TTS models behind it, each in
its own process. `MaroonedSoftware/rhapsode`, published as `ghcr.io/maroonedsoftware/rhapsode`, with
the engine SDK as the Python package `rhapsode-worker`. A rhapsode was a performer who recited written verse
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
| `POST /engines/{id}/dialogue` (§ 6) | `POST /dialogue` |
| `GET /health` | `GET /health` |
| (core policy) | `POST /load`, `POST /unload`, `POST /terminate` |
| `POST /engines/{id}/pull` (§ 10) | `POST /fetch` |

The core also answers routes no worker has, for installing and removing engines. They are about the
box rather than about speech, and § 10 describes them.

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
    "cloning": { "supported": true, "referenceSeconds": [5, 10], "formats": ["wav", "mp3", "flac", "ogg"] },
    "blending": { "supported": false },
    "streaming": { "supported": true, "granularity": "chunk" },
    "nativeFormat": { "encoding": "pcm_s16le", "sampleRate": 24000, "channels": 1 }
  },
  "variants": {
    "turbo":        { "cues": ["laugh", "..."], "deliveries": [], "dials": {},
                      "cloning": { "supported": true, "referenceSeconds": [5, 10] } },
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

**`variants` lists what this worker can load, not everything the engine has.** Orpheus's `full`
build runs on vLLM, which needs a CUDA card; on a Mac, or on a box without vLLM installed, the worker
does not list it. Listing it there would be a variant that every load fails, which a client cannot tell
from a variant that is only slow to load, and the first sign would be an error on a real request.

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

**Each variant says whether it clones**, as `cloning`, the same shape `current` carries. Cloning
needs no model (§ 7), so whether it is offered cannot wait on one being resident: a client reading
only `current` could not tell an engine that cannot clone from one that is idle, and offering a clone
form that every submission fails is the first sign it would get. It is per variant rather than per
engine because nothing makes it engine-wide: a build that conditions on reference audio and a build
that only knows its trained speakers can be the same engine, as Orpheus's base model and its
finetune are. `cloning` is optional, since contract 1 shipped without it; a reader that finds it
absent does not know, and falls back to `current`, then to offering it and letting the worker refuse.

`blending` sits beside it on every variant and in `current`, for the same reason: a blend reads the
voices it mixes and never the model (§ 7). Absent means no, because an engine blends only if its
adapter says so, and a worker that predates the field cannot.

**`dialogue` is declared per variant, and absent where it is not performed.** Dia's `1.6b` says
`"dialogue": { "maxSpeakers": 2 }`: the variant answers `POST /dialogue` (§ 6), and one request may
have up to two speakers. It is on the variant rather than the engine for the reason everything else
is: nothing in the core may depend on `current`, and a second build of the same engine can differ. A
client that does not know the field ignores it (§ 9), which is the whole of what an engine without
dialogue asks of anybody.

### `license` carries code and weights separately

The weights licence is the one that package metadata never reveals, and it is the one that decides
whether a commercial user may ship the thing. Apache-2.0 inference code over research-only weights
is a real and common combination; Breeze TTS 2 is exactly that. A licence scanner reads the package
and reports Apache-2.0, and it is wrong in the way that matters.

**`code` is the licence of what the worker process runs, not of the adapter package.** A scanner
makes the same mistake one layer down: `kokoro-onnx` is MIT, and turning text into the phonemes its
model takes goes through `phonemizer` and eSpeak NG, which are GPL-3.0-or-later. An adapter reports
the most restrictive licence among what it loads, and says in `notes` which dependency is
responsible, because that is the one a commercial user will ask about.

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

A closed set. The engine translates: `(laughs)` for Dia, `[laugh]` for Chatterbox turbo, `<laugh>`
for Orpheus, nothing at all for Piper.

An engine claims the cues it performs and not the set: Orpheus has a tag for seven of these and none
for `clear throat`, so it claims seven, and a `[clear throat]` sent to it is stripped like any other
cue it does not claim.

**The vocabulary is the only way in.** An adapter removes its engine's own tag syntax from the text
before it translates, so `<yawn>` sent to Orpheus is dropped, not performed. The alternative is a
client that learns an engine's private tags and is then tied to that engine, which is the thing this
section exists to prevent. A tag worth having on two engines is a word for this list.

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
| `language` | From the effective variant's `languages`. Absent means the first one it lists. |
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

### `language` selects among what the variant declares

`variants[...].languages` has been in the capability document from the start and there was no way to
ask for one, which made a multilingual build indistinguishable from an English one. A variant that
lists a single language ignores this field; one that lists several reads it, and a language it does
not list is `unsupported`.

It is a separate field rather than something inferred from the text because detection is a guess,
and a guess that silently picks the wrong language produces a whole take in the wrong accent with
nothing in the response to say so.

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
| `forbidden` | 403 | no | A management route (§ 10) called from somewhere it does not answer |
| `conflict` | 409 | no | A management route (§ 10) asked for something the current state rules out |

**`retryable` is a field and not something the client infers from the status.** The distinction that
matters is between "this request was wrong" and "this request was fine and the server was not", and
a caller that conflates them either retries a permanent failure forever or discards work that would
have succeeded on the next pass. A cold start that ran out of its budget is `model_unavailable`, and
a client that understands that keeps the job rather than writing it off.

### Dialogue

```http
POST /engines/{engine}/dialogue          (worker: POST /dialogue)
Content-Type: application/json
```

```json
{
  "turns": [
    { "speaker": "a", "text": "Did you hear that? [gasp]" },
    { "speaker": "b", "text": "[laugh] It's only the cat." },
    { "speaker": "a", "text": "It is never only the cat." }
  ],
  "voices": { "a": "narrator_02" },
  "variant": "1.6b",
  "format": "wav",
  "seed": 7,
  "stream": false
}
```

Some engines make a conversation in one pass, with the timing, the overlaps and the reactions of two
people in one room, which stitching separate takes together cannot make. Dia is the first. That does
not fit `/speak`, whose one `voice` is one reader, and it is a second route rather than a second shape
of `text` so that no engine without it has a request shape it must refuse half of. A variant that
performs it says so in `dialogue` (§ 4); one that does not answers the route `unsupported`.

**A turn names a speaker, not a voice.** Speakers are labels the request makes up, and `voices` maps
the ones that should sound like a particular voice to its id. A speaker with no voice is read in one
the model picks, which a `seed` holds fixed, exactly as `/speak` with no voice is. A `voice` on each
turn could not say "the same person as turn one, whoever that is", which is the ordinary case for an
engine with no voices of its own. A voice the engine does not have is `unknown_voice`, as in § 7.

| Field | Notes |
| --- | --- |
| `turns` | Required, at least one. Each is `{ speaker, text }`, and `text` has cues stripped per turn to what the variant claims. |
| `voices` | Optional. Speaker label to voice id. A label no turn uses is `bad_request`. |
| `variant`, `format`, `language`, `params`, `seed`, `stream` | As for `/speak`. |

- **More distinct speakers than `maxSpeakers` is `unsupported`**, since the variant said it cannot.
- **The ceiling is `maxCharacters` over the sum of every turn's text.** A dialogue is one take, so it
  is one budget. Splitting it into turns does not buy a longer one.
- **There is no `delivery`.** A delivery reads a whole line one way, and a dialogue has more than one
  reader. It is left out rather than half-defined; a delivery per turn waits for an engine that can
  perform one.
- **Everything about the response is `/speak`'s**: the formats, the 256-byte floor, aborting rather
  than closing when a stream fails after its headers, the duration header or trailer, and the errors.

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

**A voice id is a name**: letters, digits, `-` and `_`, starting with a letter or digit, at most 64
characters. Anything else is `bad_request`, checked before an adapter sees it. An adapter makes a
file of an id, and before the rule an id of `../../x` wrote a clone outside the voice directory and
an id of `*` matched whichever voice sorted first.

**A voice the engine does not have is `unknown_voice`, never a substitute.** An engine that falls
back to its default voice for an id it does not know hands the caller audio in a voice they did not
ask for, with a `200`, which is the silent discard this document exists to prevent.

Creating a voice, where the engine supports it:

```http
POST /engines/{engine}/voices          (worker: POST /voices)
Content-Type: multipart/form-data
  id=narrator_03  label="Narrator 03"  reference=@clip.wav  transcript="What the clip says."
  id=host         label="Host"         blend="af_bella(2)+af_sky(1)"
DELETE /engines/{engine}/voices/{id}   (worker: DELETE /voices/{id})
```

`transcript` is optional: the words spoken in the reference. An engine that clones by continuing
from the clip, as Dia does, has to be told what was said in it as well as how it sounded, and one
that is given the wrong words clones worse without any error, so there is nothing to infer it from
safely. Such an engine refuses a create without one as `bad_request`, naming the field; the capability
document has no way to say in advance that a transcript is needed, and a refusal naming the field is
the whole of the discovery. An engine that does not read it ignores it, which is the one exception to
unknown input being refused: every client can send it to every engine, so a client does not have to
know which engine reads it.

The answer to a create is the new voice, as `GET /voices` would list it. Creating an id that exists
replaces it, which is how a voice is re-recorded; its `spec` changes, so a cached preview does too.

A create carries exactly one of `reference` or `blend`, and both or neither is `bad_request`.

**`reference` is whatever this engine makes a voice from**, and `current.cloning.formats` says which
file types that is. For Chatterbox it is a clip of somebody speaking. For Kokoro it is a style
vector, the thing a Kokoro voice actually is: a `.npy` array, or a `.pt` voicepack as Kokoro-FastAPI
ships them, of shape 510 x 1 x 256. That is how a voicepack outside the engine's own set arrives,
Kokoro-FastAPI's `v0` voices included. A reference whose filename names a type the engine does not
list is `unsupported`, as any format the engine does not do is (§ 6), and one of the right type and
the wrong contents is `bad_request`. A voicepack is read as data and
never unpickled: a `.pt` file is a pickle, and unpickling an upload runs whatever the uploader wrote.

**`blend` is a mix of voices the engine already has**, where `current.blending.supported` says so.
The recipe is `name(weight)+name(weight)`, each weight optional and 1 when absent, positive, and
normalised so they sum to 1. The syntax is Kokoro-FastAPI's, because that is what an operator coming
from it already has typed into a config. Every name is a voice id (above) and must be one the
engine lists, built in or created, else `unknown_voice`.

A blend is resolved **when it is created**, into a stored voice like any other. So deleting or
re-recording a component later does not change a blend made from it, and its `spec` is minted from
the result rather than from the recipe. The alternative, a recipe resolved at every `speak`, is a
voice that changes under a caller who never touched it, which is the failure `spec` exists to catch
and would here be invisible to it.

Why a created voice and not a recipe written into `voice` at `speak` time: a recipe is not a name,
and the id rule above is what stops a voice id from being a path or a pattern. A named blend also
gets what every other voice has, a place in `GET /voices`, a `spec`, and a preview.

An engine that makes no voices answers a create with `unsupported`, and one that makes voices one
way and not the other answers the other with `unsupported` too.

**The worker owns its voice store.** The core keeps no shadow registry, because two registries is one
more than the number that can be right. It streams the upload to the worker as it arrives and keeps
no copy, so a clip costs the core no memory and no disk. It refuses a body over **25 MB** as
`bad_request`: a usable reference is 5 to 20 seconds, which is under 1 MB of 24 kHz mono WAV and
under 6 MB of 48 kHz stereo at 24 bits, so the cap is generous for any clip and small enough that a
single request cannot fill a disk.

**Creating and deleting a voice are management routes** (§ 10): they write files on the box, so the
same guard applies and a page from another machine is refused. Listing voices and hearing a preview
stay open, like speaking.

**Creating a voice loads no model and takes no residency slot.** An adapter's `create_voice` stores
the reference and returns. Work that needs the model, such as computing a speaker embedding, happens
at the first `speak` in that voice, under the lease `speak` already holds. The alternative is a clone
that evicts whatever another caller is using, from a route nobody would expect to touch the GPU, and
Chatterbox, which clones from the reference on every call anyway, has nothing to do early. A Kokoro
blend holds to the same rule: it reads the voices file, 28 MB, and never the graph, which is up to
325 MB.

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
        # Each build is its own class upstream rather than an argument, which is a fact about that
        # engine and not about this protocol. A variant name is whatever the adapter says it is.
        self.model = BUILDS[variant].from_pretrained(device=self.device.torch())

    def unload(self) -> None:
        del self.model

    def voices(self) -> list[Voice]:
        return [Voice(id=p.stem, label=p.stem, spec=f"{p.stem}@{self.variant}")
                for p in self.voice_dir.glob("*.wav")]

    def speak(self, req: SpeakRequest) -> Iterator[bytes]:
        # An engine that streams yields as it goes. One that does not, and chatterbox does not,
        # synthesises whole and chunks the result: the SDK's contract is an iterator of PCM, not a
        # promise that the model is incremental.
        yield from self.pcm_of(self.model.generate(req.text,
                                                   audio_prompt_path=self.path_for(req.voice),
                                                   **self.dials_for(req)))

serve(ChatterboxEngine())
```

### What the SDK does so no adapter has to

- Binds the socket, prints the handshake line, captures stray `stdout`, frames logs as JSON on
  stderr.
- Serves `/health`, `/capabilities`, `/voices`, `/load`, `/unload`, `/terminate`, `/fetch`,
  `/speak` and `/dialogue`.
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
- **Waits for an abandoned synthesis to end** before it loads, unloads or starts another. A model's
  `generate()` is one blocking call, so a client that hangs up stops the stream only when that call
  returns, and until then the model is still on the device. Measured with Dia on Metal: a load that
  started under an abandoned generation killed the process with "failed assertion _status <
  MTLCommandBufferStatusCommitted".

### `fetch`, the one optional verb

`fetch(variant)` downloads a variant's weights to wherever the engine keeps them, without putting
them on the device. The SDK serves it as `POST /fetch` with `{ "variant": "turbo" }`, and an adapter
that does not override it answers `unsupported`. It exists because the alternative is the first
`/speak` doing the download: Chatterbox's `turbo` is 3.8 GB and took about 75 seconds on a first
load, and a caller waiting on one utterance cannot tell that from a hang. An engine whose weights
ship inside its package, or that has none, leaves it alone.

### `dialogue`, which is declared rather than discovered

`dialogue(request)` speaks a conversation (§ 6) and yields PCM as `speak` does. An adapter that
overrides it has every variant declare `dialogue` with its `max_speakers`, and one that does not
answers `/dialogue` with `unsupported` and declares nothing. Whether a variant has it is derived from
the override, as whether an engine clones is derived from `create_voice`, so an adapter cannot claim
dialogue it did not write. The SDK checks the speakers, the voices, the ceiling and everything
`/speak` checks before `dialogue()` is called.

Unlike `fetch`, a client needs to know before it asks, because the answer decides what it offers:
the web page shows a conversation editor only where a variant declares one.

### An ONNX engine is an adapter like any other

Piper, Kokoro and Supertonic ship ONNX weights, and `onnxruntime-node` could run them inside the
core with no Python at all. **They run as workers instead**, through `onnxruntime` in their own
virtualenv, and the core has one kind of engine. This was open until v1 (§ 13) and was decided on
what running them in-process would actually have cost:

- **The model is the easy half.** These models take phonemes, not text, and every maintained route
  from one to the other goes through eSpeak NG, which is GPL-3.0-or-later, in Python and in Node
  alike. In a worker it runs in a process and a virtualenv of its own, behind a catalog entry that
  shows the licence before install (§ 4). In the core it would be loaded into an MIT server that
  holds no engine knowledge, which is the rule § 1 rests on.
- **`onnxruntime-node` is 301 MB unpacked**, and would be a dependency of every core, including the
  ones that never run an ONNX engine.
- **The benefit was a first run with no Python**, and the installer (§ 10) already builds each
  engine its own virtualenv with `uv`. The gain that remains is a first engine that needs no GPU and
  a download measured in megabytes, and a CPU worker delivers that.

What this asks of the SDK is only what it already promises: it must never depend on torch, or an
ONNX adapter could not install it. `device` is `cpu` for such an engine and means it; nothing in
this document treats CPU as a degraded case.

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

### Package versions are not the contract

Every released package carries one version, and they release together. The server ships as a
Docker image tagged with it, and `@maroonedsoftware/rhapsode-sdk` is published to npm at it. The rest carry it
without being published: the workspace packages (`@rhapsode/contract`, `@rhapsode/core` and
`rhapsode`), because the core reads its own to pin engines, below, and the Python packages
(`rhapsode-worker`, `rhapsode-conform` and every engine in the catalog), because every way to run the
core today installs engines from the sources it ships with, so nothing reads the package index yet.
Versioning them anyway means publishing one later is a release like any other, not a renumbering.
The first release is 0.1.0.

That version and `contract` answer different questions. `contract` says what a core and a worker
can say to each other, and moves only by the rules above. The package version says which code this
is. A release that changes no shape leaves `contract` where it was; a new contract major always
comes with a new package version, and the reverse is almost never true. A client reads `contract`
to decide what it may send and never parses a package version to find out.

One version rather than one per package because § 13.5 keeps the protocol and both of its
implementations in one repository so that they move in one commit, and that holds for a user only
if they also move in one release. Separate versions would need a hand-kept table of which core goes
with which engine, and the catalog would have to consult it on every install.

**An engine installed from the package index is pinned to the core's own version.** A core at
0.3.0 installs `rhapsode-engine-kokoro==0.3.0`, and every engine pins `rhapsode-worker` to its own
version exactly. Unpinned, pip resolves the newest engine on the index, which may have been built
for a core this box does not have yet. Negotiation would refuse it, but only at the first spawn,
after the virtualenv, the install and possibly gigabytes of weights were already paid for. The cost
of the pin is that an engine fix reaches a server only with a core upgrade, which under one version
is how every other fix reaches it too.

None of this narrows what the rest of this section allows. A remote worker, or an engine the
operator configured by hand, is whatever version it is, and negotiation is still what decides
whether the core will speak to it.

### The core describes its own API

`GET /openapi.json` answers with the public API as an OpenAPI 3.1 document, generated from
`contracts/` like every other shape. It is open to every caller, like `/health` and `/catalog`: it
says nothing a caller could not learn by trying, and withholding it only sends people to a copy on
the web that describes some other version.

- **Public routes only**: § 6 and § 7, the management routes of § 10, and the OpenAI shim of § 11.
  Never a worker route. A client author should not learn that workers exist, and one document for
  both cannot even be written, because `/health` and `/speak` are different operations on the same
  paths. The first combined document had the worker's in both places and described a `/speak`
  that takes no `engine`.
- **`info.version` is the running core's package version**, set when the document is served, so it
  describes this box rather than whichever build published the docs. It is still not the contract.
  A client reads `contract` from `/health` to decide what it may send, and reads this document to
  learn the shapes, whether it is a person or a generator building a client. Nothing negotiates
  from it.
- **The worker protocol is described by `docs/openapi.worker.yaml`**, committed and served by
  nobody. An engine author reads it next to `rhapsode.worker.ck`, and a worker is not required to
  describe itself: `rhapsode-conform` is what says whether it speaks the protocol.

---

## 10. Managing engines

Installing an engine is part of the API rather than a set of instructions, so that a terminal
client and a web page can both drive it and neither holds logic the other lacks. By hand it was five
steps: a virtualenv, a pip install, an edit to the config, a restart, and a first `/speak` that
silently downloaded 3.8 GB. The core still ships no interface of its own (§ 12). These routes are
what one is built on.

| Route | Does |
| --- | --- |
| `GET /catalog` | Every engine that exists, installed or not, with both licences |
| `POST /engines/{id}/install` | Starts an install job; `202` with the job. `?pull=turbo` fetches that variant too |
| `DELETE /engines/{id}` | Stops and removes an engine this API installed |
| `POST /engines/{id}/pull` | Starts a job that downloads a variant's weights; body `{ "variant": "turbo" }` |
| `GET /installs` | Every job this process knows about, newest first |
| `GET /installs/{job}` | One job |
| `GET /installs/{job}/events` | The job's progress as server-sent events |

### Who may call them

**Management routes answer loopback callers, and nobody else unless a token is configured.** With
`management.token` set, a caller presenting `Authorization: Bearer <token>` is admitted from
anywhere. Everything else gets `forbidden`. `GET /catalog` is the exception and answers everybody,
because it only reads and the licences in it are the thing § 4 promises before install.

The reason is that the server has no other authentication and binds every interface by default,
and an install runs pip. A management route open to the LAN is remote code execution for anyone on
it. The speech routes stay open because the worst a stranger can do with them is make it talk.

**A web page counts as where it came from, not where it is running.** Any page the operator visits
can make their browser send a request to `localhost`, and the browser is a loopback caller: a
cross-site `POST /engines/tone/install` from `Origin: https://evil.example` was measured answering
`202` and installing. So a request carrying an `Origin` is refused unless that origin is this
machine's own (`localhost`, `127.0.0.1`, `[::1]`, any port) or is listed in `management.origins`,
and that holds with a valid token too. A browser attaches `Origin` to every cross-site request and
every `POST`, and a page cannot forge it, which is also what defeats DNS rebinding: a rebound page's
origin is still the attacker's hostname. Clients that are not browsers send no `Origin` and are
judged on the rest.

**A proxy on this machine does not make its clients local.** The web app's dev server and nginx
both connect from loopback, and without this rule a web app served to the LAN would hand the LAN
the install routes. A request from a loopback peer carrying `X-Forwarded-For` is local only if
every address in that header is. The header is believed only from a loopback peer, and it can only
make a caller less trusted: leaving it out gains a local caller nothing it did not already have.

The guard runs before the request body is read and before any stream opens, so a refused caller is
refused cheaply and cannot hold a connection.

### The catalog

```json
[
  {
    "id": "chatterbox",
    "displayName": "Chatterbox",
    "license": { "code": "MIT", "weights": "MIT", "weightsCommercialUse": true },
    "package": "rhapsode-engine-chatterbox",
    "defaultVariant": "turbo",
    "installed": "yes",
    "managed": true
  }
]
```

`installed` is `no`, `installing` or `yes`. `managed` says whether this API installed it and can
therefore remove it; an engine the operator configured by hand is `installed: yes, managed: false`.
`GET /engines` is unchanged and still lists only what is configured: the catalog is what exists,
and `/engines` is what this box has.

### Installing

An install is four steps, and a job reports which one it is on:

1. **`venv`**: create `<install.venvDir>/<id>`, with `uv venv` when uv is on the path and the
   interpreter's own `venv` module otherwise. A directory already there that no registered engine
   points at is the remains of an install that did not finish, and is removed first. An engine
   whose dependencies install on a narrower range of Python than the SDK's says so in its catalog
   record. uv is handed the range and finds or fetches an interpreter inside it; without uv, the
   configured interpreter is asked first and the job fails naming both, because pip given an
   interpreter outside the range does not fail. It resolves the newest release that still claims to
   support it: `kokoro-onnx` 0.6.1 declares `<3.14`, and on 3.14 pip quietly installed 0.4.7.
2. **`packages`**: pip install the adapter. If `<install.sourceDir>/<package>` exists it is
   installed from there, whatever version the directory holds; otherwise it is installed by name
   from the package index, pinned to the core's own version (§ 9). The first is how a checkout and
   the server image work, and the second is how an installed core works once adapters are
   published.
3. **`verify`**: import the engine's module with the new interpreter. That is the command the core
   will spawn, minus serving, and it is the check that a virtualenv pip abandoned halfway fails,
   although its `bin/python` runs perfectly well.
4. **`register`**: record the engine in the managed file and add it to the running registry. No
   restart: the next `/speak` for it spawns a worker.
5. **`weights`**, only when asked: fetch a variant, exactly as a pull does (below).

**An install can fetch its weights.** `POST /engines/chatterbox/install?pull=turbo` adds step 5 for
the variant named; a client that wants the default reads it from the catalog's `defaultVariant`.
Without it an install stops at `register`, as it always has. A `pull` that is empty or repeated is
`bad_request`. It is one job rather than a client queueing a pull behind its install, because a
client that goes away between the two (a closed browser tab, a terminal that lost its connection)
leaves an engine whose first `/speak` sits through the whole download: 3.8 GB for Chatterbox's
`turbo`.

It is a query parameter rather than a body so that a bare `POST`, which is every install so far,
stays one. ServerKit refuses a request without a body on a route that declares one, with a `411`,
so a body here could not have been optional. And it names a variant rather than being a flag,
because the contract's booleans are coerced and `?pull=false` would have read as true.

The engine is registered before step 5 starts, so **a failed download leaves it installed**: the
job fails at `weights`, and the way on is a pull, not another install. An engine whose worker does
not implement `fetch` has nothing to do in step 5; the job says so in its output and succeeds, and
the weights arrive on first load as they would have.

`RHAPSODE_PIP_TRUSTED_HOSTS` is honoured from the server's own environment and cannot be set
through the API. Weakening certificate verification stays a decision made on the box.

Installing an engine that is already installed or already installing is `conflict`, and so is
installing one the operator's config names, even disabled: that entry would win over whatever the
install recorded. An id that is not in the catalog is `unknown_engine`. A server started without a
managed file (a core embedded as a library can be) answers `unsupported`, because it has nowhere to
record the result.

### The managed file

The core records what it installed in `rhapsode.engines.json`, beside the config file, and reads it
at boot underneath the config: **where both name the same engine, the operator's config wins.** The
core never writes the operator's file. That file may carry comments that a rewrite would lose, may
sit on a read-only path, and is somebody's hand-kept record of the box. One writer per file is the
rule that keeps both honest.

### Uninstalling

`DELETE /engines/{id}` terminates the worker, removes the engine from the registry and from the
managed file, and deletes its virtualenv, but only a virtualenv inside `install.venvDir`. An engine
the operator configured is `conflict`: it is theirs to remove, by editing their file. So is an
engine that is speaking, because an uninstall that cut a stream off would hand that caller a
truncated file for a reason it could not have predicted; the removal happens under the same lock a
load takes, so nothing can start one in between. An engine that is not installed is
`unknown_engine`.

Weights are left alone. They live in the engine's own cache (for Chatterbox, the Hugging Face cache
in the user's home), which other tools on the box share, and 9.7 GB is not something to delete as a
side effect.

### Pulling weights

`POST /engines/{id}/pull` asks the engine's worker to `fetch` a variant (§ 8): download the weights
without loading them. The worker process is started if it is not running, which costs tens of
megabytes, and no model is loaded, so it takes no residency slot and evicts nothing. An engine that
does not implement `fetch` answers `unsupported`, and its weights arrive on first load as before.

### Jobs

```json
{
  "id": "01J8Z6Q4B7",
  "engine": "chatterbox",
  "kind": "install",
  "state": "running",
  "step": "packages",
  "createdAt": "2026-09-18T14:02:11.000Z",
  "startedAt": "2026-09-18T14:02:11.004Z"
}
```

`kind` is `install` or `pull`. `variant` is the variant a pull fetches, or an install fetches in
step 5; an install without it stops at `register`. `state` is `queued`, `running`, `succeeded` or `failed`; a failed job
carries `error`, an ordinary error envelope body. Its message names the command and the line of
its output that says why it failed, not the line it printed last: pip ends a failed build with a
footer naming the package, and an Orpheus install whose error was `╰─> llama-cpp-python` had its
reason, a missing C compiler, only in the event feed. **One job runs at a time and the rest queue**,
because two pip installs racing for one disk and one network connection finish later than the same
two in a line, and a failure in one is easier to read without the other interleaved.

An id `GET /installs/{job}` does not know is `bad_request` with a `404`, as an unknown route is:
the request named something that is not there, and a finished job is only kept until fifty newer
ones have finished after it.

Jobs live in memory. A restart forgets them, and a job running at shutdown is stopped and marked
`failed`. That loses nothing that matters: a half-built virtualenv is caught by step 1 of the next
install.

`GET /installs/{job}/events` streams the job's events: step changes as `progress`, each line pip
and the interpreter print as `log`, and the outcome as `status` or `error`. A client that
reconnects with `Last-Event-ID` resumes where it left off, and one whose resume point has already
fallen out of the replay buffer is sent a `resync` event and should re-read the job. The stream does
not end when the job does: a job's last event is a `progress` whose `status` is `done` or
`failed`, and a client closes the stream when it sees one. Ending it from the server would make a
browser's `EventSource` reconnect to a finished job over and over. The filter is pinned to the job
in the path, so a query parameter cannot widen it to another job's output. The frame
format is ServerKit's server feed, so the same client code reads it wherever ServerKit is used.

---

## 11. The OpenAI shim

The native API is the contract, and adoption runs through other people's clients. Most of those
speak OpenAI's `POST /v1/audio/speech`, and pointing one at this server should need a base URL and
nothing else.

```http
POST /v1/audio/speech
Content-Type: application/json
```

```json
{ "model": "chatterbox:turbo", "input": "Right, that was The Verve Pipe. [laugh]", "voice": "narrator_02", "response_format": "opus" }
```

**The shim is a translation into `/speak`, not a second implementation of it.** It builds a native
request and hands it to the same code, so the ceiling, the cue stripping, the dial check, the
residency lease and the rules for failing after the headers (§ 6) are the ones `/speak` applies, and
cannot drift from them. The `/v1` in the path is OpenAI's and says nothing about this contract's
version, which is § 9's business.

| Field | Becomes |
| --- | --- |
| `model` | Required. An engine id, or `engine:variant`. An exact engine id is tried first, so an id with a colon in it is still reachable. |
| `input` | `text`. Cues in it are handled as `/speak` handles them. |
| `voice` | `voice`. Absent means the engine's default, although OpenAI's own API requires it. |
| `response_format` | `format`. Absent means `mp3`, because that is OpenAI's default. `aac` is `unsupported`. |
| `speed` | A dial named `speed` on the effective variant. Absent or `1` sends nothing. |
| `instructions` | `unsupported` unless absent or empty. |
| `stream_format` | `audio` or absent. `sse` is `unsupported`. |

The response always streams, as OpenAI's does. A caller that wants the duration header or the better
error that `stream: false` gives (§ 6) wants the native API.

### `model` names an engine, and `tts-1` is not one

A `model` that is not an installed engine is `unknown_engine`, and the message lists the ones that
are. There is no alias that maps `tts-1` to a default engine, for the reason § 7 gives for voices: a
substitute is audio nobody asked for, delivered with a `200`. A client hardcoded to `tts-1` is
misconfigured, and the refusal is what tells its operator so.

`alloy` is not a voice either, and is `unknown_voice` like any other id the engine lacks. An operator
whose client cannot be told another name can clone a voice with the id `alloy`: voice ids are theirs
to choose.

### What has no equivalent is refused, not dropped

The shim could drop `instructions` and a `speed` it cannot honour and answer `200`. That is the
silent discard § 6 refuses for dials, and for the same reason: the client believes it asked for
something. So a non-empty `instructions` is `unsupported`, and so is a `speed` other than `1` on a
variant with no `speed` dial. A `speed` outside the dial's range is `bad_request`, as any dial is.

A field the shim does not know is `bad_request` naming it. OpenAI's own API refuses an unrecognised
field with a `400`, so strictness holds a client to nothing it was not already held to. `delivery`,
`params`, `seed` and `language` are not accepted: the native API takes them, and adding them here
would make a second native API with a worse name. A multilingual variant speaks the first language
it lists, as `/speak` does when `language` is absent.

A cue in `input` is different. Stripping one the variant does not claim is § 5 making the request
performable, not the shim discarding a field, and it happens silently here exactly as it does in
`/speak`.

The shim has no dialogue. OpenAI's speech request has one voice, so it translates into `/speak`
and only ever reaches one reader, on an engine that performs dialogue as on any other.

### `mp3` by default needs ffmpeg

Because OpenAI's default is `mp3`, a client that says nothing gets `mp3`, which needs an ffmpeg with
`libmp3lame` on the worker's box. Without one the answer is `unsupported` saying so. The shim does
not fall back to `wav`: a client that saves the body as `speech.mp3` never reads the `Content-Type`,
and a WAV with the wrong extension is a bug report that arrives weeks later from somebody else.

### `pcm` is the engine's rate, not OpenAI's

OpenAI's `pcm` is 24 kHz, 16-bit, mono. Here it is the engine's native format, as it is in `/speak`,
and the `Content-Type` says which: `audio/L16; rate=24000; channels=1`. The core does not resample,
because it holds no audio knowledge. Chatterbox is 24 kHz, so it matches; an engine at 22.05 kHz
plays about 9% fast in a client that assumes. A client that cannot read a `Content-Type` should ask
for `wav`, whose header carries the rate.

### Errors

The envelope is OpenAI's, because that is what the clients parse. The status is § 6's, and the
taxonomy survives in `code`:

```json
{
  "error": {
    "message": "no voice \"alloy\"",
    "type": "invalid_request_error",
    "param": "voice",
    "code": "unknown_voice",
    "retryable": false
  }
}
```

`type` is `invalid_request_error` when the request was wrong (not retryable, and under `500`), and
`server_error` otherwise. `param` names the request field the failure is about, when there is one.

**Every error carries `x-should-retry`, set from `retryable`.** OpenAI's SDKs retry `408`, `409`,
`429` and every `5xx` twice by default, deciding by status, so without the header an `internal` 500,
which § 6 says is not retryable, is sent three times. Both official SDKs read `x-should-retry`
before the status, so with it they retry exactly what the taxonomy says to.

### Who may call it

Anybody who may call `/speak`, which is anybody. OpenAI's clients will not start without an API key
and send it as `Authorization: Bearer`; the shim ignores it. The header is stripped before any
handler runs (§ 10), so a key typed into a client is never logged.

Only this route is served. `GET /v1/models` and the rest of OpenAI's API wait for a client that
needs them.

---

## 12. Deliberately not in v1

Named so that nobody has to guess whether they were forgotten.

- **STT.** A different problem wearing a similar hat. Say no once, in the README.
- **A delivery in a dialogue.** § 6 says why it is left out, and it waits for an engine that can
  perform one per turn.
- **Word timestamps.** Wanted, cheap enough as an optional sidecar response, and not worth blocking
  v1. Leave room: a `X-Rhapsode-Timings-Url` header or a `timings` field in a multipart response.
- **Batching.** Adapters declare `concurrency` and that is the whole of it for now.
- **Engines inside the core.** Every engine is a worker, ONNX ones included. § 8 says why.
- **A UI in the core.** The gap this project fills is that everything else has one, and has put
  its API behind it. A web page for installing engines is a client of § 10 like any other, and gets
  no route the terminal client does not. Its API reference renders `GET /openapi.json` (§ 9), the
  document every other client can read, rather than a copy of its own.

## 13. Open questions

1. **Dialogue.** Decided: a second endpoint, declared per variant (§ 4, § 6). A structured `text`
   would have put a shape into every engine's request that most of them must refuse half of; a second
   route splits the API only for the engines that have something to put there. Turns name speakers
   rather than voices, because an unvoiced speaker is the ordinary case for Dia.
2. **Does the core ever hold audio?** Decided: only when `stream: false` was asked for, and only
   the one response, in memory. § 6 already depends on it: the floor can only become an error
   envelope if the core has the whole body before it writes a status, and `Content-Length` and the
   duration header can only be headers if the length is known. A `stream: true` response goes
   through at constant memory. The buffer is bounded by the variant's `maxCharacters`, not by
   anything the client sends. Retry-on-truncation and content-addressed caching were the arguments
   for buffering everything. Neither is in v1, and whichever arrives first reopens this.
3. **Voice namespacing across engines.** Decided: not this server's job. A voice id is scoped to
   its engine (§ 7) and names one engine's rendering of one reference. The same clip cloned on two
   engines gives two voices that sound related, not one voice, and an alias spanning them would
   promise a sameness the server cannot deliver and add a second id space for the § 7 rules to
   police. A client that means "the same person" on three engines keeps its own table of
   `(engine, voice)` pairs, which is also the only place that knows which of those it thinks are
   close enough.
4. **In-process ONNX engines.** Decided: no. ONNX engines are Python workers like every other
   engine, for the reasons in § 8, and "engine" in the registry keeps meaning one thing.
5. **Where the core lives.** Decided: `MaroonedSoftware/rhapsode`, one repository holding the
   protocol, the core and the Python worker SDK. `MaroonedSoftware` already publishes ServerKit and
   ContractKit, which the core builds on. A change to the protocol has to land in both
   implementations at once or one of them is wrong, and one repository with one `pnpm test` is what
   makes that a single commit rather than a coordinated pair of releases. The cost is that the SDK
   cannot version on its own cadence. Revisit when it has outside users who need it to.
