# Changelog

Every package releases at one version. protocol.md § 9.

## 0.1.8

- `POST /engines/{id}/install` now refuses to install weights that may not be used commercially unless
  the request names their licence: `?accept=CC-BY-NC-4.0`, the catalog's `weights` string exactly.
  Without it the refusal is `bad_request` before any job starts, and it names the licence and the query
  that accepts it. An `accept` sent for commercial weights must still name their licence, so a client can
  send it on every install. The web page and the wizard already showed both licences before an install,
  but a script calling the route directly never saw either. `protocol.md` § 10 says why the licence is
  named rather than being a flag. The route now declares its `400` answer, so the SDK returns the
  refusal as a value.
- The web page and `pnpm wizard install` now send the weights licence they showed as `?accept=`, so
  they go on installing engines whose weights may not be used commercially now that the core requires
  it. The wizard's "Install under these licences?" prompt now defaults to no for those engines, since
  pressing return through a prompt is not reading it. `--yes` still accepts from a script.

## 0.1.7

- `GET /engines` and `GET /health` now carry `workerVersion` for each engine: the version of
  `rhapsode-worker` installed in that engine's virtualenv. `protocol.md` § 9 pins an engine to the
  core's version when it is installed, and an upgrade is the one thing that breaks that pin, because
  the virtualenvs live on the volume an upgrade deliberately keeps. Nothing said so. Negotiation
  refuses a worker whose contract is too new and is silent about one that is too old, and every field
  added inside a contract major since that worker was built is simply one it never sends: a box
  upgraded from 0.1.3 to 0.1.6 went on speaking through a 0.1.2 worker and only stopped reporting
  `sizeBytes`, which reads as a card that cannot be measured rather than as an engine to reinstall.
  
  It is read from the virtualenv rather than asked of the worker, so an engine that is `down` still
  answers, which is an engine's ordinary state now that a model leaves the card when nothing is using
  it. It is a diagnostic and never an input to negotiation: nothing branches on it, and a client still
  reads `contract` to decide what it may send. It is absent, rather than guessed, for a remote engine
  and for any virtualenv whose metadata cannot be read.
- `pnpm wizard doctor` gains an "engine freshness" check: every local engine's `rhapsode-worker`
  against the core's own version, naming any that an upgrade left behind and what to do about it.
  Informational rather than red, for the reason `protocol.md` § 9 gives — a stale worker speaks a
  contract this core still supports, so it works, and an operator is free to run an engine at a
  version of their choosing. It answers the question that was previously only findable by listing
  a virtualenv's `site-packages` by hand.
  
  It reads the virtualenvs the config names rather than asking a running server, because the doctor
  is for a checkout and the server may not be up. Against a container, `workerVersion` on
  `GET /engines` is the same answer from the same helper.

## 0.1.6

- An eviction now asks the worker to end its own process with `POST /terminate` and signals only when
  that does not land, which is the order `protocol.md` § 2 and § 3 always described and the code had
  backwards. The fix that matters is for a remote worker: evicting one used to destroy its connection
  pool, and because the core keeps the handle, every later request to that engine failed until the
  core restarted. A remote worker now gets the verb and keeps its connection, a local one gets the
  verb before the signal with the same `SIGKILL` backstop as before, and a shutdown still signals
  without asking. § 2 Stop gains the paragraph saying which is reached for when.
- A model with nothing left to do now leaves the card after five minutes, where before it stayed until
  something else needed the room. `residency.keepAliveSeconds` is the one setting for it and replaces
  the `idleUnloadSeconds` and `idleTerminateSeconds` pair: two deadlines were needed when there were
  two verbs to choose between, and an expiry now always terminates, because `protocol.md` § 3 measured
  an unload leaving roughly 30% behind and a deadline that runs every few minutes would give a card
  away 30% at a time. **This is on by default and it is a behaviour change**: set `keepAliveSeconds` to
  `-1` for what this server did before. Both old names are still read when the new one is absent, with
  a line in the log saying which was found, so no configuration file stops a server from starting.
  Note that `null` is not `-1`: the sample in `operating.md` documented `"idleUnloadSeconds": null` to
  mean off, and a null is read as "not set", so a file copied from it gets the five-minute default.
  An expiry also no longer terminates a model that was picked up again while its timer was already on
  its way, which was a race that could only get worse with a deadline running by default.
- An engine entry can carry its own `keepAliveSeconds`, overriding the server-wide one for that engine
  alone (`protocol.md` § 3). The deadline trades a cold start against a held card, and a cold start is
  per engine: a model that takes forty seconds to load has earned a longer stay than one that takes
  two, and the server-wide setting cannot tell them apart. `-1` on an engine pins its model where the
  rest of the server expires.
- `POST /speak` and `POST /engines/{engine}/dialogue` take `keepAliveSeconds`, saying how long the
  model that request loads should stay once it is done: `-1` never expires, `0` gives the card back as
  the audio ends, and anything else is a deadline in seconds (`protocol.md` § 3). It is the one thing
  the server cannot know and the caller often does, which is whether more is coming. Precedence is
  request, then engine, then server, and the last request to take a lease wins, because two requests
  sharing a model cannot both be right about how long it stays. A keep-alive is not a reservation: an
  eviction under a full budget still takes a pinned model, which is what keeps § 3's load-on-demand
  rule true for everybody else. The field is on the public request shapes only and is never forwarded
  to a worker, since an adapter that can see a keep-alive will eventually act on one. The OpenAI shim
  does not take it, as it takes none of the native fields (§ 11). The client SDK and the OpenAPI
  document carry it, from the same contract.
- A worker measures what a load cost and reports it as `WorkerHealth.modelBytes` (`protocol.md` § 3).
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
- `GET /residency` lists what is on the card: engine, variant, how many requests are still speaking
  it, when it was last used, when it expires, the keep-alive actually in force and what the worker
  measured it taking (`protocol.md` § 3). `/health` only ever gave counts, so an operator whose card
  was full could see that one model was resident and nothing about which, how large, or when it would
  go. `expiresAt` is absent while a model is speaking, because the deadline starts when the last
  request lets go, and absent when its keep-alive says never. Like `/health` and `/engines` it reads
  the core's own state: it starts no worker and waits on none, since listing what is loaded should not
  be a reason to load anything. It is deliberately not a route to call before speaking, as `/speak`
  loads on demand and § 3 spends a rule on why a client should not ask first. The client SDK gains
  `residency()` from the same contract.
- `POST /engines/{engine}/unload` frees a model now rather than waiting out its keep-alive
  (`protocol.md` § 3 and § 10). `?mode=terminate` is the default and ends the worker process, which is
  the only way to get back the roughly 30% an unload strands; `?mode=unload` keeps the process for a
  faster next load. It is behind the management guard, because somebody who can empty a card can make
  every synthesis on the box pay a cold start, and it is idempotent: an engine holding nothing is
  already in the state the request asks for, and a soft unload of nothing starts no worker to discover
  that. A terminate still ends a process holding no model, which is how an operator reclaims what a
  variant switch left behind. It is refused with `409` while the engine is speaking, for the reason an
  uninstall is: cutting off a stream hands that caller a truncated file for something they could not
  have predicted. The wizard and the web page get the same verb in the releases after this one.
- `pnpm wizard ps` shows what the running server has loaded, how big each model is and when it
  expires, and `pnpm wizard unload <engine>` gives that memory back now (`protocol.md` § 3). Both are
  clients of the API and hold no logic of their own, which is what keeps the wizard and the web page
  from drifting. `unload` terminates by default, since somebody at a terminal asking for memory back
  means all of it, and `--keep-process` is the soft verb that trades the roughly 30% an unload strands
  for a faster next load. A size that nothing could measure prints as a dash rather than as zero, and
  a model with a request still speaking it shows what is holding it instead of a countdown that has
  not started.
- The Engines page gains "On the card": what this server has loaded, how big each model is, when it
  expires, and a button to unload it now (`protocol.md` § 3). It is the one polled query in the page,
  because a keep-alive runs out without anything here asking it to, and a row left on screen minutes
  after its model has gone is worse than no row. A model with a request still speaking it shows what
  is holding it and its button is disabled rather than offered and refused, since the core answers a
  `409` there. A size nothing could measure shows as a dash, never as zero. A page opened from another
  machine reads the panel and is not offered the buttons, which is the same rule the install actions
  already follow.

## 0.1.5

- The worker SDK splits long text where a reader would pause, so an adapter's `speak()` says one thing and `maxCharacters` stops being every client's problem. An adapter declares `segment_characters` and the SDK breaks the request on sentences, then clauses, then words, calls `speak()` once per piece, seeds each piece from the request's seed plus its index, and joins the audio with whatever silence the adapter declares in `segment_pause_ms`. Three adapters had written this privately and two had written it identically: `_fit` and `_pack` in the Dia and Orpheus adapters were the same twenty lines character for character, and Kokoro's third copy had no clause fallback and a sentence pattern missing the ellipsis, so a long sentence reached the model whole. All three now call `rhapsode_worker.segments`, and Kokoro's loop is gone entirely because it carried nothing across the joint. The capability document declares the split as `segmentation`, beside `cloning` and `blending`, because a client cannot see it and is affected by it: a seed reproduces a generation, so a request split four ways is four seeded generations, and prosody carries across a joint only where the engine carries it. The shared splitter also keeps a two-word cue such as `[clear throat]` whole, which the adapters' own copies only managed because they translated cues into a space-free spelling first.

## 0.1.4

- `docs/openapi.yaml` describes the public API alone, and at the release version rather than `1.0.0`. It used to merge in the worker protocol, whose `/health` and `/speak` replaced the public ones: the document described a `/speak` that takes no `engine`. The worker protocol has its own document, `docs/openapi.worker.yaml`.
- The core serves its public API as OpenAPI 3.1 at `GET /openapi.json`, open to every caller like `/health`, with `info.version` set to the running core's version. The client SDK gains `openapi()` to read it. Worker routes are never in it.
- The web page has an **API** page listing every route the core answers, read from `GET /openapi.json`: parameters, request fields, every declared response, which routes are management routes, and the models they use. It is drawn from the running core, so it always matches the installed version.
- **Try it** shows the request it sends as code, curl or the TypeScript SDK, under "As code", with a copy button. It is built from the same body the Speak button sends, so the copied call reproduces what was heard.
- Cloning a voice takes an optional `transcript`, the words spoken in the reference clip, for an engine that clones by continuing from the clip. Such an engine refuses a create without one as `bad_request`, naming the field, and every other engine ignores it. The web page's clone form has a Transcript field, `CreateVoiceRequest.transcript` carries it to an adapter, and the conformance suite sends one with every clone.
- Each entry in a capability document's `variants` now says whether it clones, as `cloning`, the same shape `current` carries. Cloning needs no loaded model, so a client can now tell an engine that cannot clone from one that is idle. The field is optional, since contract 1 shipped without it, and the conformance suite checks that it matches what `POST /voices` actually does.
- **Try it** offers the clone form only when the chosen variant says it can clone, so Orpheus, whose voices are names its finetune was trained on, no longer shows a form that every clip would fail. A worker too old to say still gets the form, and its refusal is shown as before.
- Dia is in the catalog: Nari Labs' 1.6B model through transformers, performing all eight cues, with `cfgScale`, `temperature` and `topP` dials. It has no voices of its own, so a request naming none is read in the voice the model picks, which a `seed` fixes and which a long text keeps from its first piece to its last. It clones from a clip and its `transcript`. Its code and weights are Apache-2.0, 6.7 GB with its codec, and it wants an NVIDIA card: on a Mac it runs at about a tenth of real time. `rhapsode-engine-dia` is the new adapter package.
- `POST /engines/{engine}/dialogue` speaks a conversation in one take, on a variant whose capability document declares `dialogue` with its `maxSpeakers` (protocol.md § 6). Each turn names a speaker, and `voices` maps speakers to voice ids; a speaker with no voice is read in one the engine picks. Cues are stripped per turn, the ceiling is the sum of every turn's text, more speakers than the variant takes is `unsupported`, and a variant that does not declare it answers `unsupported`. The response is `/speak`'s in every other respect. The worker SDK gains `Engine.dialogue`, `DialogueRequest` and `max_speakers`, and declares dialogue wherever an adapter overrides it; the tone engine performs one, the client SDK has `dialogue()`, and the conformance suite checks it where it is declared.
- The worker SDK waits for a synthesis whose client hung up to end before it loads, unloads or starts another. An engine that makes audio in one blocking call, as Chatterbox and Dia do, kept running that call after the client left, and a load or unload that started under it could crash the worker: with Dia on Metal it did.
- Dia speaks dialogue: `POST /engines/dia/dialogue` makes two speakers in one pass, each with a cloned voice or one the model picks. A long conversation is read in windows of whole turns, each continuing from the voices' clips or from its own first window.
- The web page's Try it offers a conversation wherever the chosen variant declares `dialogue`: a switch between a line and a conversation of up to the variant's `maxSpeakers`, a list of turns, and a voice for each speaker. Nothing about it is written for a particular engine.
- Kokoro makes voices two ways through `POST /engines/kokoro/voices`. A `blend` recipe, `af_bella(2)+af_sky(1)` in Kokoro-FastAPI's syntax, is mixed once and kept under its own id. A `reference` is a style vector, a `.npy` or a Kokoro-FastAPI `.pt` voicepack, which is how its `v0` voices such as `am_v0gurney` come across; a `.pt` is read as data and never unpickled. The capability document says which: `current.cloning.formats` lists what a reference may be, and `current.blending.supported` whether an engine blends. The worker SDK gains an optional `blend_voice` and `reference_formats`, the conformance suite checks a blend's round trip, and the page's Try it offers a blend form and asks each engine for the files it takes.
- A worker keeps its connection open after an adapter's own exception. A plain `ValueError` or similar out of an adapter still answers `internal` with a 500, and the next request on that keep-alive connection is no longer reset. A streamed `/speak` that fails after its headers still aborts the connection, as § 6 requires.
- Text full of `[` with no `]` no longer takes quadratic time to scan for cues. The core's cue report read from every `[` to the end of the text, so 40,000 of them took 5.6 s; it now stops at the next `[`.
- Each of Dia's generations is given a budget of decoder tokens from how much text it holds, because Dia does not always stop on its own: measured on an RTX 4070 Ti SUPER, "one" ran to 27 seconds of murmur where a ten-word line stopped by itself after 3.8 seconds, so a shorter text made more audio than a longer one. A piece that uses its whole budget is logged, as one that fills the decoder's positions already was.

## 0.1.3

- `@maroonedsoftware/rhapsode-sdk` names its repository, which npm requires to accept its provenance. 0.1.2 was refused for want of it, so no 0.1.2 of the SDK exists on npm; the image and every other part of 0.1.2 were published.
- An install can download an engine's weights in the same job: `POST /engines/chatterbox/install?pull=turbo` runs a fifth step, `weights`, once the engine is registered, so the first `/speak` does not wait on the download. A failed download leaves the engine installed, to be finished with a pull, and an engine that cannot download ahead of time succeeds and fetches on first load. The SDK's `installEngine` takes an optional `{ pull }` query. A bare `POST .../install` is unchanged.
- The web page downloads an engine's default weights as part of installing it, so an engine it installs is ready to speak. The install dialog has a "Download the turbo weights too" box, ticked by default, and the job shows the download as a fifth step. If only the download fails, the page says the engine is installed and its weights can be downloaded from its card.
- `pnpm wizard install <engine>` asks about the weights before it starts, and the server downloads them as part of the install job instead of in a second job afterwards. If only the download fails, it says the engine is installed and that `--pull` retries the download. For an engine that is already installed, `--pull` still downloads its weights on their own.

## 0.1.2

- The Docker image carries git, so installing Chatterbox works in it. Upstream Chatterbox names its watermarker, `resemble-perth`, by `git+https`, and every Chatterbox install in the container failed with "Cannot find command 'git'".

## 0.1.1

- `rhapsode-engine-chatterbox` installs upstream from commit `5de7a54` on resemble-ai/chatterbox's master instead of from PyPI's 0.1.7, because Nano is in no release yet. `turbo`, `original` and `multilingual` load, speak and clone on MPS against it unchanged. An install behind a TLS-intercepting proxy now needs `github.com,codeload.github.com` in `RHAPSODE_PIP_TRUSTED_HOSTS`, and the adapter cannot be published to PyPI until upstream releases, since PyPI refuses a direct reference.
- `rhapsode-engine-chatterbox` has a fourth build, `nano`: Resemble's 110M-parameter Chatterbox Nano, loaded through upstream's turbo class with `nano=True`. It performs the same eight cues as `turbo`, has no dials, speaks English, and clones from a reference clip. Its weights are a 3.0 GB fetch from `ResembleAI/chatterbox-nano`, of which 1.9 GB is what it loads. `turbo` stays the default.
- `rhapsode-engine-chatterbox`'s README says what `nano` costs against `turbo`, measured on an Apple M5 Pro: on MPS, 5.0x realtime against 2.7x for the stock voice and 3.7x against 1.3x for a clone.
- `rhapsode-engine-chatterbox`: a request that names no voice speaks as the build's own voice again after a clone has run. Upstream keeps one set of voice conditionals per model and a clone overwrites it, so every voiceless request after the first clone spoke as that clone.
- `rhapsode-engine-chatterbox` analyses a cloned voice's reference clip once per resident build and keeps the result, instead of on every request. A warm clone now costs what the stock voice does. Re-recording a voice, changing its file on disk, or loading another build analyses it again, and the 32 most recently used voices are kept, about 1.3 MB each.
- The client SDK is published as `@maroonedsoftware/rhapsode-sdk`, under the organisation that already publishes ServerKit. `@rhapsode/sdk` never reached npm: nobody owns the `@rhapsode` scope there. Import from the new name.

## 0.1.0

- `pnpm wizard setup` takes a fresh checkout to a running server: it syncs the Python venv (offering to retry trusting PyPI when a TLS-intercepting proxy breaks pip), builds, writes `rhapsode.config.json` for the tone engine and runs the conformance suite. `pnpm wizard doctor` checks Node, pnpm, Python, the venv, the build, the config, every local engine's venv, the server port and ffmpeg, and `--fix` repairs the venv, the build and a missing config.
- `rhapsode-engine-chatterbox` now loads on Apple Silicon: the device reaches upstream as a string, which is what upstream checks before mapping a CUDA-saved checkpoint onto the CPU. It also pins `setuptools<81`, without which upstream's watermarker import fails silently and every build fails to load on a fresh install.
- `rhapsode-worker`: a model load that throws a `TypeError`, `ValueError` or `KeyError` is now reported as `internal` (500) rather than `bad_request` (400). The request named a variant and nothing else, so the failure is never the caller's to fix.
- The contract declares the engine management API from protocol.md § 10: `CatalogEntry`, `InstallJob`, `PullRequest` and `FeedEvent`, and the `/catalog`, `/engines/{engine}` (delete), `/engines/{engine}/install`, `/engines/{engine}/pull` and `/installs` operations. The error taxonomy gains `forbidden` (403) and `conflict` (409) at the end. No route answers yet.
- The server reads `rhapsode.engines.json` beside its config file, underneath it: where both name an engine, the operator's config wins field by field. Nothing writes the file yet; the install API that does is next. `loadSettings(configPath)` and `ManagedEngines` are exported for other composition roots.
- `GET /catalog` lists every engine that exists, with both licences, its Python package, and whether this box has it. A management guard (`managementGuard`) admits loopback callers, or a caller presenting `management.token` as a bearer token, and refuses anyone else with `forbidden`. ServerKit's own refusals, such as a wrong content type, now answer `bad_request` rather than `internal` 500.
- Engines can be installed and uninstalled through the API. `POST /engines/{engine}/install` queues a job that creates `<install.venvDir>/<engine>`, pip installs the adapter and the worker SDK (from `install.sourceDir`, the checkout's `python/` by default, or else the package index), imports the module to prove it, records the engine in `rhapsode.engines.json` and makes it available without a restart. `GET /installs` and `GET /installs/{job}` report jobs, which run one at a time. `DELETE /engines/{engine}` stops and removes an engine this API installed, and its virtualenv. All of them answer loopback callers, or a caller with `management.token`. `buildServer`'s third argument is now an options object: `{ managed, runner }`.
- `GET /installs/{job}/events` streams a job's progress, output lines and outcome as server-sent events, resumable with `Last-Event-ID`. The last event of a job is a `progress` with `status` `done` or `failed`; the stream stays open after it, and a client closes it.
- `POST /engines/{engine}/pull` queues a job that downloads a variant's weights through the worker's new `POST /fetch`, without loading anything, so a first `/speak` does not sit through the download. The worker SDK gains an optional `Engine.fetch(variant)`, which answers `unsupported` unless an adapter overrides it; `rhapsode-engine-chatterbox` implements it with the same repositories and files its loads read. The conformance suite checks that `/fetch` either succeeds without loading or says `unsupported`.
- `pnpm wizard install <engine>` installs an engine through the running server: it shows both licences and asks, follows the install as it happens, and offers to download the default variant's weights. `--yes` accepts the licences from a script, `--pull` downloads without asking, and `--server` and `--token` reach a server on another machine. It is a client of `docs/protocol.md` § 10 and holds no install logic of its own.
- Management routes refuse a request from a browser page that did not come from this machine or from an origin listed in the new `management.origins`, closing a hole where any website the operator visited could install or uninstall an engine by making their browser POST to localhost. A request forwarded by a proxy on this machine is local only if every address in `X-Forwarded-For` is.
- `@rhapsode/sdk`, a typed client for the public API generated from `contracts/` by ContractKit and committed. It has no dependencies. `new RhapsodeSdk({ baseUrl }).public` has a method per operation; a declared error status comes back as a value with the protocol's envelope, and an undeclared one throws `SdkError`. Read a job's event stream with an `EventSource` rather than `installJobEvents`, which cannot return while the stream is open.
- `apps/web`, a web page for installing engines, starts as a read-only catalog: every engine rhapsode knows about, with the licence for its code and, separately, for its weights, and which of them this box has. `pnpm --filter @rhapsode/web dev` serves it on port 8081 and proxies `/api` to a core on 8080.
- The web page installs, uninstalls and downloads weights. Install shows both licences and asks first; a job is followed as it happens, with its steps and the output pip prints, from the core's event stream; uninstall asks first and says the weights stay. A page opened from another machine sees the catalog, no buttons, and the core's reason.
- `rhapsode-worker`: a voice id must be a name (letters, digits, `-` and `_`, starting with a letter or digit, at most 64 characters), checked on create, delete, speak and preview before any adapter sees it. Before this, an id of `../../x` wrote a clone's reference outside the voice directory, and `*` matched whichever voice sorted first. The SDK now depends on `python-multipart`, without which every `POST /voices` failed with a 500.
- `rhapsode-engine-tone` clones: a voice's pitch comes from its reference's hash, so every clip makes a different voice, and an unknown voice is `unknown_voice` rather than the default sine. `rhapsode-engine-chatterbox`'s voice `spec` now changes when the reference does, and a re-record replaces the old clip whatever its extension. The conformance suite checks the clone round trip on engines that clone, and that an unknown voice or a voice id that is a path is refused.
- `rhapsode-worker`: a `ValueError`, `TypeError` or `KeyError` raised by adapter code is now `internal` (500) everywhere, not `bad_request` (400); the SDK raises `bad_request` itself for a request that is wrong. `rhapsode-engine-chatterbox` clones on Apple Silicon: turbo's loudness step returned float64, which MPS cannot hold, so every clone failed at its first `speak`.
- `POST /engines/{engine}/voices` clones a voice and `DELETE /engines/{engine}/voices/{voice}` removes one, behind the management guard. The upload is streamed to the worker with no copy kept, and refused over 25 MB. Each local worker now keeps its voices in `<workers.voiceDir>/<engine>`, `~/.rhapsode/voices` by default, rather than under the core's working directory.
- A "Try it" page: pick an installed engine, variant, voice, delivery, dials, language and seed from its capability document, insert the cues that variant performs, and hear the line in the page. A first request says it is loading the model when it takes more than a few seconds.
- `rhapsode-worker` keeps the label a clone was created with, in `.labels.json` in the voice store, and applies it when listing, so every adapter keeps labels without doing anything. Before, a voice created as "The Announcer" was listed as "Announcer" a moment later.
- Try it lists an engine's voices with a preview for each, clones a new voice from an uploaded clip (with its id checked before the upload, and the 25 MB cap), selects the new voice so it can be heard straight away, and deletes clones after asking.
- The contract declares the OpenAI shim from protocol.md § 11: `OpenAISpeechRequest`, `OpenAIErrorBody` and the `POST /v1/audio/speech` operation. No route answers yet.
- `rhapsode-worker`: a streamed `wav` whose engine fails before its first chunk, such as on an unknown voice, now answers with the error's status instead of a `200` and an aborted connection. The SDK primed the encoded stream, and a WAV's header comes out before the engine is asked for anything.
- `POST /v1/audio/speech` answers OpenAI's speech request, translated into `/speak` (protocol.md § 11). `model` is an engine id or `engine:variant`. `tts-1` and `alloy` are refused rather than substituted, and so are `aac`, `stream_format: "sse"`, non-empty `instructions`, and a `speed` other than 1 on a variant with no `speed` dial. Errors use OpenAI's envelope, keep the taxonomy code in `code`, and carry `x-should-retry` from `retryable`.
- `POST /speak` passes `language` to the engine. It was dropped in the core, so a multilingual variant always spoke its first language, and a language the variant does not list was never refused as `unsupported`.
- `POST /speak` refuses a field the contract does not declare with `bad_request` naming it. A misspelling such as `streaming: false` used to be ignored, and the caller got a stream it thought it had turned off.
- A catalog record can name the Python versions its engine installs on. With uv the install asks for an interpreter in that range; without it, the install fails at the `venv` step naming the range and the interpreter it has, rather than letting pip resolve an older release of the engine's dependencies.
- Kokoro is in the catalog: an ONNX engine that runs on the CPU with no torch, in three precisions (`fp16` by default, `fp32`, `int8`), with 28 English voices and a `speed` dial that the OpenAI shim's `speed` now reaches. Its weights are Apache-2.0; the code it runs is GPL-3.0-or-later through phonemizer and eSpeak NG, and the catalog says so. `rhapsode-engine-kokoro` is the new adapter package.
- `pnpm wizard setup` ends by suggesting `pnpm wizard install kokoro`, and the README and operating guide start with Kokoro rather than Chatterbox: it runs on any machine, on the CPU, from a 205 MB download. `pnpm wizard doctor` checks that the Kokoro adapter imports in the dev venv.
- rhapsode runs in Docker. `docker compose up` builds and starts the server and the web page, keeping the config, its management token and cloned voices in a `/config` volume and every installed engine, the Python it runs on and its weights in a `/data` volume, so an install survives the image being rebuilt. The image has no Python of its own, so that a base image upgrade cannot break the virtualenvs in `/data`. The page's container presents the management token for it, which is why both ports are published on 127.0.0.1 only. It runs under any uid, including unraid's 99:100, and docs/operating.md § Docker has what it keeps where.
- `rhapsode-engine-orpheus` is a new engine, and in the catalog: Orpheus (Canopy Labs' Llama 3.2 3B finetune) through llama.cpp, in `q8` and `q4` builds that run on Metal, CUDA or the CPU. It performs seven of the eight standard cues (not `clear throat`, which it has no tag for), speaks in the finetune's eight voices, and streams audio as each frame decodes instead of chunking a finished waveform. `docs/protocol.md` § 5 now says an adapter strips its engine's own tag syntax, so the standard vocabulary is the only way to reach a cue.
- `rhapsode-engine-orpheus` runs in the server image on an NVIDIA card. On Linux x86_64 the package installs vLLM rather than llama.cpp, which has no wheel there and needs a C++ compiler the image does not have, and serves the `full` build: the finetune unquantised, from unsloth's ungated bfloat16 copy, so no Hugging Face token is needed. Elsewhere it installs llama.cpp and serves `q8` and `q4` as before, and `[llama]` asks for them on a Linux box without an NVIDIA card. The worker lists only the builds its install can load, with `full` first where it can run, and has no fixed default. vLLM samples with PyTorch rather than FlashInfer, which needs nvcc, runs one sequence at a time, and claims 7 GiB of the card. Measured on an RTX 4070 Ti SUPER in the image: 1.05 times real time, first audio after 0.34 seconds, 7.5 GB of VRAM, and `rhapsode-conform` passes all 35 checks. `docs/protocol.md` § 4 now says a worker lists only the variants it can load.
- The server image carries `gcc` and `libc6-dev`, 182 MB, because Triton under vLLM compiles a small C helper at run time, and Orpheus's `full` build failed every load in the image without a C compiler. It is C only: there is still no C++ compiler and no CUDA toolkit in the image.
- A failed install job's error names the line that says why, not the last line pip printed. A package built from source used to fail with pip's footer, such as `python exited 1: ╰─> llama-cpp-python`; it now fails with the build's own error, such as `CMake Error: CMAKE_CXX_COMPILER not set, after EnableLanguage (building llama-cpp-python)`. A certificate failure is named as one, where pip's last line said there was no matching distribution.
- `rhapsode-worker`: a `stream: false` answer to `/speak` carries `X-Rhapsode-Duration-Ms`, the length of the take in milliseconds, as protocol § 6 says it does. It is computed from the PCM, so it is right for mp3 and opus as well as wav and pcm.
- `@rhapsode/core`: `/speak` with `stream: false` now reads the worker's whole answer before sending a status, as protocol § 6 says. A body too small to be audio is a `500` envelope with code `internal` instead of an aborted connection, and the response carries `Content-Length` and `X-Rhapsode-Duration-Ms`, which the core used to drop. `stream: true` is unchanged.
- `@rhapsode/core`: an engine installed by name from the package index is now pinned to the core's own version, `rhapsode-engine-kokoro==<core version>` together with `rhapsode-worker==<core version>`, as protocol § 9 now says every package releases at one version. An install from `install.sourceDir`, which is how a checkout and the server image work, is unchanged. Each engine pins `rhapsode-worker` to its own version exactly, and a test holds every engine, the worker SDK and the core to one number.
- `docker compose up` pulls `ghcr.io/maroonedsoftware/rhapsode` rather than building it, so downloading `compose.yaml` is the whole install, with no checkout. `RHAPSODE_VERSION` pins a release. The image is published for amd64 and arm64 with every release, at the version every package carries. To build from a checkout: `docker compose -f compose.yaml -f compose.build.yaml up -d --build`.
- `rhapsode-worker`: a streamed `/speak` ends with an `X-Rhapsode-Duration-Ms` trailer, declared up front in a `Trailer` header, as protocol § 6 says. uvicorn cannot send trailers, so the SDK now serves on uvicorn's h11 implementation (never httptools, even where it is installed) and adds them itself. A request over HTTP/1.0, or a worker run under another server, gets the same response without the trailer.
- `@rhapsode/core`: a streamed `/speak` now reaches the client with the worker's `X-Rhapsode-Duration-Ms` trailer. The core already declared the `Trailer` header, but it ended the response before adding the trailer, so the value was dropped every time. As § 6 says, treat it as best effort: `fetch` cannot read trailers, and a client that needs the duration on every response should ask for `stream: false`.
- `rhapsode-worker` now requires `uvicorn>=0.33,<0.54`, where it accepted anything from 0.30 below 1.0. The streamed duration trailer is written through uvicorn internals that can change in any pre-1.0 minor release, so each new minor is a deliberate upgrade, made after the worker suite passes on it. The floor is where the SDK stops a synthesis when the client hangs up: on 0.30 to 0.32 the engine ran on after the client had gone.
- `rhapsode-worker`: a worker that is sent SIGTERM more than once exits 0 after draining, as protocol § 2 says, instead of sometimes dying of the second signal with -15. It also logs `draining` once rather than once per signal.
- `rhapsode-worker` and `rhapsode-conform`: their READMEs link to the protocol by its full GitHub URL, so the link works on their PyPI pages as well as in the repository. It was a path relative to the checkout, which PyPI cannot follow.
- The Docker image serves the web page itself, so `docker compose up` runs one container instead of two. nginx runs beside the server in the same container, proxying `/api` to it over loopback and presenting the management token, and both ports are still published on 127.0.0.1 only. On unraid that is one container with ports 8080 and 8081, with no network to create and no `RHAPSODE_UPSTREAM`. Coming from the two-container compose, run `docker compose up -d --remove-orphans`, because the old page container still holds port 8081.
- There is no `web` image: `docker/Dockerfile` builds only the server, which serves the page itself. The server no longer writes `/config/management.token` for a page container to read, and removes one left by an earlier version, so the token is kept only in `rhapsode.config.json`.
