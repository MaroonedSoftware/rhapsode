import type { JsonValue } from '../../sdk-options.js';

/**
 * generated from [Dial](../../../../../../contracts/rhapsode.types.ck#L15)
 */
export interface Dial {
    /** Inclusive. */
    min: number;
    /** Inclusive. */
    max: number;
    /** What the engine uses when the request says nothing. */
    default: number;
}

/**
 * A build that speaks a conversation in one pass. protocol.md § 6.
 * generated from [Dialogue](../../../../../../contracts/rhapsode.types.ck#L36)
 */
export interface Dialogue {
    maxSpeakers: number;
}

/**
 * generated from [Cloning](../../../../../../contracts/rhapsode.types.ck#L40)
 */
export interface Cloning {
    supported: boolean;
    /** [min, max] of usable reference audio. */
    referenceSeconds?: number[];
    /** File types a `reference` may be. § 7. */
    formats?: string[];
}

/**
 * Whether a create may carry a `blend` recipe instead of a `reference`. § 7.
 * generated from [Blending](../../../../../../contracts/rhapsode.types.ck#L47)
 */
export interface Blending {
    supported: boolean;
}

/**
 * generated from [Streaming](../../../../../../contracts/rhapsode.types.ck#L51)
 */
export interface Streaming {
    supported: boolean;
    granularity?: 'chunk' | 'sentence';
}

/**
 * generated from [NativeFormat](../../../../../../contracts/rhapsode.types.ck#L56)
 */
export interface NativeFormat {
    /** v1 accepts pcm_s16le and nothing else. */
    encoding: string;
    sampleRate: number;
    channels: number;
}

/**
 * generated from [EngineIdentity](../../../../../../contracts/rhapsode.types.ck#L73)
 */
export interface EngineIdentity {
    id: string;
    displayName: string;
    adapterVersion: string;
    upstreamVersion?: string;
}

/**
 * Code and weights separately, because the weights licence is the one package metadata never reveals
 * and the one that decides whether a commercial user may ship. A scanner reads the package, reports
 * the code licence, and is wrong in the way that matters.
 * generated from [License](../../../../../../contracts/rhapsode.types.ck#L83)
 */
export interface License {
    code: string;
    weights: string;
    weightsCommercialUse: boolean;
    notes?: string;
}

/**
 * generated from [Device](../../../../../../contracts/rhapsode.types.ck#L90)
 */
export interface Device {
    type: 'cuda' | 'rocm' | 'mps' | 'cpu';
    name: string;
    vramBytes?: number;
}

/**
 * generated from [Voice](../../../../../../contracts/rhapsode.types.ck#L110)
 */
export interface Voice {
    id: string;
    label: string;
    description?: string;
    /** Opaque. Changes whenever the rendering would. Never parse it. */
    spec: string;
    tags?: string[];
    /** Worker-scoped; the core rewrites it on the way out. */
    previewUrl?: string;
}

/**
 * generated from [CreateVoiceForm](../../../../../../contracts/rhapsode.types.ck#L119)
 */
export interface CreateVoiceForm {
    id: string;
    label?: string;
    /** Exactly one of `reference` and `blend`. § 7. */
    reference?: Blob;
    /** A recipe, `name(weight)+name(weight)`, over voices the engine has. */
    blend?: string;
    /** The words spoken in the reference. Required by an engine that continues from it. */
    transcript?: string;
}

/**
 * generated from [SpeakRequest](../../../../../../contracts/rhapsode.types.ck#L131)
 */
export interface SpeakRequest {
    text: string;
    voice?: string;
    /** Absent means whatever is loaded. */
    variant?: string;
    format?: 'wav' | 'mp3' | 'opus' | 'flac' | 'pcm';
    /** From the effective variant's `languages`. */
    language?: string;
    /** Closed, and deliberately has no word for "ordinary". */
    delivery?: 'hushed' | 'frantic';
    /** Validated against the effective variant's dials. */
    params?: Record<string, number>;
    seed?: number;
    stream?: boolean;
}

/**
 * One speaker's line in a conversation. `speaker` is a label the request makes up, not a voice.
 * generated from [DialogueTurn](../../../../../../contracts/rhapsode.types.ck#L151)
 */
export interface DialogueTurn {
    speaker: string;
    text: string;
}

/**
 * generated from [LoadRequest](../../../../../../contracts/rhapsode.types.ck#L174)
 */
export interface LoadRequest {
    variant?: string;
}

/**
 * Required, unlike a load's: there is no "whatever is loaded" to fall back on for weights that are
 * not loaded yet. protocol.md § 8.
 * generated from [FetchRequest](../../../../../../contracts/rhapsode.types.ck#L180)
 */
export interface FetchRequest {
    variant: string;
}

/**
 * `retryable` is a field rather than something the client infers from the status, because the
 * distinction that matters is between "this request was wrong" and "this request was fine and the
 * server was not". A caller that conflates them either retries a permanent failure forever or
 * discards work that would have succeeded on the next pass.
 * generated from [ErrorDetail](../../../../../../contracts/rhapsode.types.ck#L192)
 */
export interface ErrorDetail {
    /**
     * A closed set that § 9 grows at the end. A reader that meets a code from a newer contract must
     * not lose the envelope over it: `message` and `retryable` are the two fields that decide what
     * the caller does next, and they parse fine. The core falls back to `internal` for the code and
     * keeps the rest, rather than reporting a parse failure in place of the real error.
     */
    code:
        | 'bad_request'
        | 'unknown_engine'
        | 'unknown_voice'
        | 'unsupported'
        | 'model_unavailable'
        | 'oom'
        | 'overloaded'
        | 'internal'
        | 'forbidden'
        | 'conflict';
    message: string;
    retryable: boolean;
}

/**
 * generated from [WorkerHealth](../../../../../../contracts/rhapsode.types.ck#L210)
 */
export interface WorkerHealth {
    process: 'up' | 'draining';
    model: 'unloaded' | 'loading' | 'loaded' | 'unloading';
    variant?: string;
    device?: string;
    /** What the card holds in total. */
    vramBytes?: number;
    /** What the loaded model took of it, measured. § 3. */
    modelBytes?: number;
}

/**
 * generated from [ResidencySummary](../../../../../../contracts/rhapsode.types.ck#L230)
 */
export interface ResidencySummary {
    resident: number;
    max: number;
    waiting: number;
    /** Named, because a wait at maxResidentModels 1 looks exactly like a hang. */
    blockedBy?: string;
}

/**
 * One model on the card, and what the core knows about it. protocol.md § 3.
 * generated from [ResidentModel](../../../../../../contracts/rhapsode.types.ck#L238)
 */
export interface ResidentModel {
    engine: string;
    variant: string;
    /** Requests still speaking it. A model with leases is not evictable. */
    leases: number;
    /** ISO 8601, UTC. */
    lastUsedAt: string;
    /** Absent while it is speaking, or when its keep-alive says never. */
    expiresAt?: string;
    /** The one in force here: request, then engine, then server. */
    keepAliveSeconds: number;
    /** What the worker measured the model taking, where it could. */
    sizeBytes?: number;
}

/**
 * generated from [PullRequest](../../../../../../contracts/rhapsode.types.ck#L288)
 */
export interface PullRequest {
    /** Absent means the engine's default variant. */
    variant?: string;
}

/**
 * One event on a job's stream, `GET /installs/{job}/events`. The shape is ServerKit's server feed,
 * declared here so a client can parse it without depending on ServerKit.
 * generated from [FeedProgress](../../../../../../contracts/rhapsode.types.ck#L294)
 */
export interface FeedProgress {
    /** The job's step. */
    phase: string;
    index: number;
    total: number;
    status: 'running' | 'done' | 'failed';
}

/**
 * What one build of an engine can perform. Capabilities depend on which build is loaded, which is
 * the whole reason this document has two levels: chatterbox `turbo` performs the paralinguistic
 * tags and discards the dials, while `original` is the other way round.
 * generated from [Variant](../../../../../../contracts/rhapsode.types.ck#L24)
 */
export interface Variant {
    /** A subset of the standard vocabulary, § 5. */
    cues: string[];
    /** Ditto. Not an enum: § 9 forbids failing on an unknown one. */
    deliveries: string[];
    /** Engine-specific numbers, named by the adapter. */
    dials: Record<string, Dial>;
    languages?: string[];
    /** Overrides the engine's own ceiling for this build. */
    maxCharacters?: number;
    /** Optional only because contract 1 shipped without it. § 4. */
    cloning?: Cloning;
    /** Beside cloning, for the same reason: it needs no model. § 7. */
    blending?: Blending;
    /** Present only where this build answers /dialogue. § 6. */
    dialogue?: Dialogue;
}

/**
 * generated from [EngineSummary](../../../../../../contracts/rhapsode.types.ck#L219)
 */
export interface EngineSummary {
    id: string;
    displayName: string;
    license: License;
    process: 'down' | 'starting' | 'up' | 'draining' | 'failed';
    model: 'unloaded' | 'loading' | 'loaded' | 'unloading';
    variant?: string;
    lastError?: string;
    restarts: number;
}

/**
 * What exists, installed or not. `/engines` is what this box has; this is what it could have, with
 * both licences, because the weights licence is only worth reading before the install.
 * generated from [CatalogEntry](../../../../../../contracts/rhapsode.types.ck#L265)
 */
export interface CatalogEntry {
    id: string;
    displayName: string;
    license: License;
    /** The Python distribution the installer installs. */
    package: string;
    defaultVariant?: string;
    installed: 'no' | 'installing' | 'yes';
    /** Installed through the API, so removable by it. */
    managed: boolean;
}

/**
 * The public shape, which the worker's `/speak` does not share: `keepAliveSeconds` is core policy
 * and a worker has no opinion about how long anything stays resident. protocol.md § 3.
 * generated from [EngineSpeakRequest](../../../../../../contracts/rhapsode.types.ck#L145)
 */
export interface EngineSpeakRequest extends SpeakRequest {
    engine: string;
    /** -1 never expires, 0 frees on release. */
    keepAliveSeconds?: number;
}

/**
 * A conversation in one take. protocol.md § 6. `/speak`'s fields except `text`, `voice` and
 * `delivery`: a delivery reads a whole line one way, and a dialogue has more than one reader.
 * generated from [DialogueRequest](../../../../../../contracts/rhapsode.types.ck#L158)
 */
export interface DialogueRequest {
    turns: DialogueTurn[];
    /** Speaker label to voice id. */
    voices?: Record<string, string>;
    variant?: string;
    format?: 'wav' | 'mp3' | 'opus' | 'flac' | 'pcm';
    language?: string;
    params?: Record<string, number>;
    seed?: number;
    stream?: boolean;
}

/**
 * generated from [ErrorBody](../../../../../../contracts/rhapsode.types.ck#L202)
 */
export interface ErrorBody {
    error: ErrorDetail;
}

/**
 * generated from [InstallJob](../../../../../../contracts/rhapsode.types.ck#L275)
 */
export interface InstallJob {
    id: string;
    engine: string;
    kind: 'install' | 'pull';
    /** What a pull fetches, or an install fetches in step 5. */
    variant?: string;
    state: 'queued' | 'running' | 'succeeded' | 'failed';
    step?: 'venv' | 'packages' | 'verify' | 'register' | 'weights';
    /** ISO 8601, UTC. */
    createdAt: string;
    startedAt?: string;
    finishedAt?: string;
    /** Present exactly when `state` is `failed`. */
    error?: ErrorDetail;
}

/**
 * generated from [ResidencyDetail](../../../../../../contracts/rhapsode.types.ck#L248)
 */
export interface ResidencyDetail extends ResidencySummary {
    models: ResidentModel[];
}

/**
 * generated from [FeedEvent](../../../../../../contracts/rhapsode.types.ck#L301)
 */
export interface FeedEvent {
    /** The Last-Event-ID resume key. */
    id: number;
    ts: string;
    source: string;
    level: 'debug' | 'info' | 'warn' | 'error';
    kind: 'progress' | 'status' | 'log' | 'error' | 'heartbeat';
    message?: string;
    /** The job id. */
    correlationId?: string;
    progress?: FeedProgress;
    data?: JsonValue;
}

/**
 * The resident build, and everything true only while it is resident. Absent from the capability
 * document entirely when nothing is loaded, because a worker in up(unloaded) has nothing to
 * describe and an invented answer is worse than no answer.
 * generated from [CurrentVariant](../../../../../../contracts/rhapsode.types.ck#L65)
 */
export interface CurrentVariant extends Omit<Variant, 'cloning' | 'blending'> {
    variant: string;
    cloning: Cloning;
    /** Absent means no, so a worker that predates it is read correctly. */
    blending?: Blending;
    streaming: Streaming;
    nativeFormat: NativeFormat;
}

/**
 * generated from [CoreHealth](../../../../../../contracts/rhapsode.types.ck#L252)
 */
export interface CoreHealth {
    contract: number;
    status: 'ok' | 'degraded';
    engines: EngineSummary[];
    residency: ResidencySummary;
}

/**
 * As `EngineSpeakRequest` is to `SpeakRequest`, and for the same reason.
 * generated from [EngineDialogueRequest](../../../../../../contracts/rhapsode.types.ck#L170)
 */
export interface EngineDialogueRequest extends DialogueRequest {
    keepAliveSeconds?: number;
}

/**
 * generated from [Capabilities](../../../../../../contracts/rhapsode.types.ck#L96)
 */
export interface Capabilities {
    /** The contract major this worker settled on. § 9. */
    contract: number;
    engine: EngineIdentity;
    license: License;
    device: Device;
    current?: CurrentVariant;
    variants: Record<string, Variant>;
    /** What this worker can actually encode, here and now. */
    formats: string[];
}
