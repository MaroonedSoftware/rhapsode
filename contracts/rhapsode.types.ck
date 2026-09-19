options {
    keys: {
        area: rhapsode
    }
}

# Every shape both halves of the protocol share. The public API and the worker API are declared in
# their own files and both reference these, which is what makes "a worker speaks the engine-scoped
# subset of the public API" (protocol.md § 1) checkable rather than a claim in prose.

############################################################################################
# The capability document. protocol.md § 4.
############################################################################################

contract mode(loose) Dial: {
    min: number             # Inclusive.
    max: number             # Inclusive.
    default: number         # What the engine uses when the request says nothing.
}

# What one build of an engine can perform. Capabilities depend on which build is loaded, which is
# the whole reason this document has two levels: chatterbox `turbo` performs the paralinguistic
# tags and discards the dials, while `original` is the other way round.
contract mode(loose) Variant: {
    cues: array(string)                 # A subset of the standard vocabulary, § 5.
    deliveries: array(string)           # Ditto. Not an enum: § 9 forbids failing on an unknown one.
    dials: record(string, Dial)         # Engine-specific numbers, named by the adapter.
    languages?: array(string)
    maxCharacters?: int                 # Overrides the engine's own ceiling for this build.
}

contract mode(loose) Cloning: {
    supported: boolean
    referenceSeconds?: array(number)    # [min, max] of usable reference audio.
    formats?: array(string)
}

contract mode(loose) Streaming: {
    supported: boolean
    granularity?: enum(chunk, sentence)
}

contract mode(loose) NativeFormat: {
    encoding: string        # v1 accepts pcm_s16le and nothing else.
    sampleRate: int
    channels: int
}

# The resident build, and everything true only while it is resident. Absent from the capability
# document entirely when nothing is loaded, because a worker in up(unloaded) has nothing to
# describe and an invented answer is worse than no answer.
contract mode(loose) CurrentVariant: Variant & {
    variant: string
    cloning: Cloning
    streaming: Streaming
    nativeFormat: NativeFormat
}

contract mode(loose) EngineIdentity: {
    id: string
    displayName: string
    adapterVersion: string
    upstreamVersion?: string
}

# Code and weights separately, because the weights licence is the one package metadata never reveals
# and the one that decides whether a commercial user may ship. A scanner reads the package, reports
# the code licence, and is wrong in the way that matters.
contract mode(loose) License: {
    code: string
    weights: string
    weightsCommercialUse: boolean
    notes?: string
}

contract mode(loose) Device: {
    type: enum(cuda, rocm, mps, cpu)
    name: string
    vramBytes?: int
}

contract mode(loose) Capabilities: {
    contract: int                           # The contract major this worker settled on. § 9.
    engine: EngineIdentity
    license: License
    device: Device
    current?: CurrentVariant
    variants: record(string, Variant)
    formats: array(string)                  # What this worker can actually encode, here and now.
}

############################################################################################
# Voices. protocol.md § 7.
############################################################################################

contract mode(loose) Voice: {
    id: string
    label: string
    description?: string
    spec: string            # Opaque. Changes whenever the rendering would. Never parse it.
    tags?: array(string)
    previewUrl?: string     # Worker-scoped; the core rewrites it on the way out.
}

contract CreateVoiceForm: {
    id: string
    label?: string
    reference: binary
    transcript?: string     # The words spoken in the reference. Required by an engine that continues from it.
}

############################################################################################
# Speaking. protocol.md § 6.
############################################################################################

contract SpeakRequest: {
    text: string(min=1)
    voice?: string
    variant?: string                                    # Absent means whatever is loaded.
    format?: enum(wav, mp3, opus, flac, pcm)
    language?: string                                   # From the effective variant's `languages`.
    delivery?: enum(hushed, frantic)                    # Closed, and deliberately has no word for "ordinary".
    params?: record(string, number)                     # Validated against the effective variant's dials.
    seed?: int
    stream?: boolean
}

contract EngineSpeakRequest: SpeakRequest & {
    engine: string
}

contract LoadRequest: {
    variant?: string
}

# Required, unlike a load's: there is no "whatever is loaded" to fall back on for weights that are
# not loaded yet. protocol.md § 8.
contract FetchRequest: {
    variant: string
}

############################################################################################
# Failure. protocol.md § 6.
############################################################################################

# `retryable` is a field rather than something the client infers from the status, because the
# distinction that matters is between "this request was wrong" and "this request was fine and the
# server was not". A caller that conflates them either retries a permanent failure forever or
# discards work that would have succeeded on the next pass.
contract mode(loose) ErrorDetail: {
    # A closed set that § 9 grows at the end. A reader that meets a code from a newer contract must
    # not lose the envelope over it: `message` and `retryable` are the two fields that decide what
    # the caller does next, and they parse fine. The core falls back to `internal` for the code and
    # keeps the rest, rather than reporting a parse failure in place of the real error.
    code: enum(bad_request, unknown_engine, unknown_voice, unsupported, model_unavailable, oom, overloaded, internal, forbidden, conflict)
    message: string
    retryable: boolean
}

contract mode(loose) ErrorBody: {
    error: ErrorDetail
}

############################################################################################
# Residency. protocol.md § 3.
############################################################################################

contract mode(loose) WorkerHealth: {
    process: enum(up, draining)
    model: enum(unloaded, loading, loaded, unloading)
    variant?: string
    device?: string
    vramBytes?: int
}

contract mode(loose) EngineSummary: {
    id: string
    displayName: string
    license: License
    process: enum(down, starting, up, draining, failed)
    model: enum(unloaded, loading, loaded, unloading)
    variant?: string
    lastError?: string
    restarts: int
}

contract mode(loose) ResidencySummary: {
    resident: int
    max: int
    waiting: int
    blockedBy?: string      # Named, because a wait at maxResidentModels 1 looks exactly like a hang.
}

contract mode(loose) CoreHealth: {
    contract: int
    status: enum(ok, degraded)
    engines: array(EngineSummary)
    residency: ResidencySummary
}

############################################################################################
# Managing engines. protocol.md § 10.
############################################################################################

# What exists, installed or not. `/engines` is what this box has; this is what it could have, with
# both licences, because the weights licence is only worth reading before the install.
contract mode(loose) CatalogEntry: {
    id: string
    displayName: string
    license: License
    package: string                             # The Python distribution the installer installs.
    defaultVariant?: string
    installed: enum(no, installing, yes)
    managed: boolean                            # Installed through the API, so removable by it.
}

contract mode(loose) InstallJob: {
    id: string
    engine: string
    kind: enum(install, pull)
    variant?: string                            # For a pull: the variant being fetched.
    state: enum(queued, running, succeeded, failed)
    step?: enum(venv, packages, verify, register, weights)
    createdAt: string                           # ISO 8601, UTC.
    startedAt?: string
    finishedAt?: string
    error?: ErrorDetail                         # Present exactly when `state` is `failed`.
}

contract PullRequest: {
    variant?: string                            # Absent means the engine's default variant.
}

# One event on a job's stream, `GET /installs/{job}/events`. The shape is ServerKit's server feed,
# declared here so a client can parse it without depending on ServerKit.
contract mode(loose) FeedProgress: {
    phase: string                               # The job's step.
    index: int
    total: int
    status: enum(running, done, failed)
}

contract mode(loose) FeedEvent: {
    id: int                                     # The Last-Event-ID resume key.
    ts: string
    source: string
    level: enum(debug, info, warn, error)
    kind: enum(progress, status, log, error, heartbeat)
    message?: string
    correlationId?: string                      # The job id.
    progress?: FeedProgress
    data?: json
}
