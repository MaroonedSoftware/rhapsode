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
 * generated from [Cloning](../../../../../../contracts/rhapsode.types.ck#L32)
 */
export interface Cloning {
    supported: boolean;
    /** [min, max] of usable reference audio. */
    referenceSeconds?: number[];
    formats?: string[];
}

/**
 * generated from [Streaming](../../../../../../contracts/rhapsode.types.ck#L38)
 */
export interface Streaming {
    supported: boolean;
    granularity?: 'chunk' | 'sentence';
}

/**
 * generated from [NativeFormat](../../../../../../contracts/rhapsode.types.ck#L43)
 */
export interface NativeFormat {
    /** v1 accepts pcm_s16le and nothing else. */
    encoding: string;
    sampleRate: number;
    channels: number;
}

/**
 * generated from [EngineIdentity](../../../../../../contracts/rhapsode.types.ck#L59)
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
 * generated from [License](../../../../../../contracts/rhapsode.types.ck#L69)
 */
export interface License {
    code: string;
    weights: string;
    weightsCommercialUse: boolean;
    notes?: string;
}

/**
 * generated from [Device](../../../../../../contracts/rhapsode.types.ck#L76)
 */
export interface Device {
    type: 'cuda' | 'rocm' | 'mps' | 'cpu';
    name: string;
    vramBytes?: number;
}

/**
 * generated from [Voice](../../../../../../contracts/rhapsode.types.ck#L96)
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
 * generated from [CreateVoiceForm](../../../../../../contracts/rhapsode.types.ck#L105)
 */
export interface CreateVoiceForm {
    id: string;
    label?: string;
    reference: Blob;
    /** The words spoken in the reference. Required by an engine that continues from it. */
    transcript?: string;
}

/**
 * generated from [SpeakRequest](../../../../../../contracts/rhapsode.types.ck#L116)
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
 * generated from [LoadRequest](../../../../../../contracts/rhapsode.types.ck#L132)
 */
export interface LoadRequest {
    variant?: string;
}

/**
 * Required, unlike a load's: there is no "whatever is loaded" to fall back on for weights that are
 * not loaded yet. protocol.md § 8.
 * generated from [FetchRequest](../../../../../../contracts/rhapsode.types.ck#L138)
 */
export interface FetchRequest {
    variant: string;
}

/**
 * `retryable` is a field rather than something the client infers from the status, because the
 * distinction that matters is between "this request was wrong" and "this request was fine and the
 * server was not". A caller that conflates them either retries a permanent failure forever or
 * discards work that would have succeeded on the next pass.
 * generated from [ErrorDetail](../../../../../../contracts/rhapsode.types.ck#L150)
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
 * generated from [WorkerHealth](../../../../../../contracts/rhapsode.types.ck#L168)
 */
export interface WorkerHealth {
    process: 'up' | 'draining';
    model: 'unloaded' | 'loading' | 'loaded' | 'unloading';
    variant?: string;
    device?: string;
    vramBytes?: number;
}

/**
 * generated from [ResidencySummary](../../../../../../contracts/rhapsode.types.ck#L187)
 */
export interface ResidencySummary {
    resident: number;
    max: number;
    waiting: number;
    /** Named, because a wait at maxResidentModels 1 looks exactly like a hang. */
    blockedBy?: string;
}

/**
 * generated from [PullRequest](../../../../../../contracts/rhapsode.types.ck#L230)
 */
export interface PullRequest {
    /** Absent means the engine's default variant. */
    variant?: string;
}

/**
 * One event on a job's stream, `GET /installs/{job}/events`. The shape is ServerKit's server feed,
 * declared here so a client can parse it without depending on ServerKit.
 * generated from [FeedProgress](../../../../../../contracts/rhapsode.types.ck#L236)
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
}

/**
 * generated from [EngineSummary](../../../../../../contracts/rhapsode.types.ck#L176)
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
 * generated from [CatalogEntry](../../../../../../contracts/rhapsode.types.ck#L207)
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
 * generated from [EngineSpeakRequest](../../../../../../contracts/rhapsode.types.ck#L128)
 */
export interface EngineSpeakRequest extends SpeakRequest {
    engine: string;
}

/**
 * generated from [ErrorBody](../../../../../../contracts/rhapsode.types.ck#L160)
 */
export interface ErrorBody {
    error: ErrorDetail;
}

/**
 * generated from [InstallJob](../../../../../../contracts/rhapsode.types.ck#L217)
 */
export interface InstallJob {
    id: string;
    engine: string;
    kind: 'install' | 'pull';
    /** For a pull: the variant being fetched. */
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
 * generated from [FeedEvent](../../../../../../contracts/rhapsode.types.ck#L243)
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
 * generated from [CurrentVariant](../../../../../../contracts/rhapsode.types.ck#L52)
 */
export interface CurrentVariant extends Variant {
    variant: string;
    cloning: Cloning;
    streaming: Streaming;
    nativeFormat: NativeFormat;
}

/**
 * generated from [CoreHealth](../../../../../../contracts/rhapsode.types.ck#L194)
 */
export interface CoreHealth {
    contract: number;
    status: 'ok' | 'degraded';
    engines: EngineSummary[];
    residency: ResidencySummary;
}

/**
 * generated from [Capabilities](../../../../../../contracts/rhapsode.types.ck#L82)
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
