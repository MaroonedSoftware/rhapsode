import { z } from 'zod';

const _ZodBinary = z.custom<Buffer>(val => Buffer.isBuffer(val), { error: 'Must be binary data' });
type _JsonValue = string | number | boolean | null | _JsonValue[] | { [key: string]: _JsonValue };
const _ZodJson: z.ZodType<_JsonValue> = z.lazy(() =>
    z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(_ZodJson), z.record(z.string(), _ZodJson)]),
);

/**
 * generated from [Dial](../../../../contracts/rhapsode.types.ck#L15)
 */
export const Dial = z.looseObject({
    min: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number()).describe('Inclusive.'),
    max: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number()).describe('Inclusive.'),
    default: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number())
        .describe('What the engine uses when the request says nothing.'),
});
export type Dial = z.infer<typeof Dial>;

/**
 * A build that speaks a conversation in one pass. protocol.md § 6.
 * generated from [Dialogue](../../../../contracts/rhapsode.types.ck#L37)
 */
export const Dialogue = z.looseObject({
    maxSpeakers: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int()),
});
export type Dialogue = z.infer<typeof Dialogue>;

/**
 * generated from [Cloning](../../../../contracts/rhapsode.types.ck#L41)
 */
export const Cloning = z.looseObject({
    supported: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()),
    referenceSeconds: z
        .array(z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number()))
        .optional()
        .describe('[min, max] of usable reference audio.'),
    formats: z.array(z.string()).optional().describe('File types a `reference` may be. § 7.'),
});
export type Cloning = z.infer<typeof Cloning>;

/**
 * Whether a create may carry a `blend` recipe instead of a `reference`. § 7.
 * generated from [Blending](../../../../contracts/rhapsode.types.ck#L48)
 */
export const Blending = z.looseObject({
    supported: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()),
});
export type Blending = z.infer<typeof Blending>;

/**
 * Whether text longer than one generation is split rather than refused. protocol.md § 8.
 *
 * Declared because a client cannot see the split and is affected by it: a `seed` reproduces a
 * generation, so a request split four ways is four seeded generations, and prosody carries across a
 * joint only where the engine carries it.
 * generated from [Segmentation](../../../../contracts/rhapsode.types.ck#L57)
 */
export const Segmentation = z.looseObject({
    supported: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()),
    segmentCharacters: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int())
        .optional()
        .describe('The most one generation gets. Absent where nothing splits.'),
});
export type Segmentation = z.infer<typeof Segmentation>;

/**
 * generated from [Streaming](../../../../contracts/rhapsode.types.ck#L62)
 */
export const Streaming = z.looseObject({
    supported: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()),
    granularity: z.enum(['chunk', 'sentence']).optional(),
});
export type Streaming = z.infer<typeof Streaming>;

/**
 * generated from [NativeFormat](../../../../contracts/rhapsode.types.ck#L67)
 */
export const NativeFormat = z.looseObject({
    encoding: z.string().describe('v1 accepts pcm_s16le and nothing else.'),
    sampleRate: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int()),
    channels: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int()),
});
export type NativeFormat = z.infer<typeof NativeFormat>;

/**
 * generated from [EngineIdentity](../../../../contracts/rhapsode.types.ck#L84)
 */
export const EngineIdentity = z.looseObject({
    id: z.string(),
    displayName: z.string(),
    adapterVersion: z.string(),
    upstreamVersion: z.string().optional(),
});
export type EngineIdentity = z.infer<typeof EngineIdentity>;

/**
 * Code and weights separately, because the weights licence is the one package metadata never reveals
 * and the one that decides whether a commercial user may ship. A scanner reads the package, reports
 * the code licence, and is wrong in the way that matters.
 * generated from [License](../../../../contracts/rhapsode.types.ck#L94)
 */
export const License = z.looseObject({
    code: z.string(),
    weights: z.string(),
    weightsCommercialUse: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()),
    notes: z.string().optional(),
});
export type License = z.infer<typeof License>;

/**
 * generated from [Device](../../../../contracts/rhapsode.types.ck#L101)
 */
export const Device = z.looseObject({
    type: z.enum(['cuda', 'rocm', 'mps', 'cpu']),
    name: z.string(),
    vramBytes: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int()).optional(),
});
export type Device = z.infer<typeof Device>;

/**
 * generated from [Voice](../../../../contracts/rhapsode.types.ck#L121)
 */
export const Voice = z.looseObject({
    id: z.string(),
    label: z.string(),
    description: z.string().optional(),
    spec: z.string().describe('Opaque. Changes whenever the rendering would. Never parse it.'),
    tags: z.array(z.string()).optional(),
    previewUrl: z.string().optional().describe('Worker-scoped; the core rewrites it on the way out.'),
});
export type Voice = z.infer<typeof Voice>;

/**
 * generated from [CreateVoiceForm](../../../../contracts/rhapsode.types.ck#L130)
 */
export const CreateVoiceForm = z.strictObject({
    id: z.string(),
    label: z.string().optional(),
    reference: _ZodBinary.optional().describe('Exactly one of `reference` and `blend`. § 7.'),
    blend: z.string().optional().describe('A recipe, `name(weight)+name(weight)`, over voices the engine has.'),
    transcript: z.string().optional().describe('The words spoken in the reference. Required by an engine that continues from it.'),
});
export type CreateVoiceForm = z.infer<typeof CreateVoiceForm>;

/**
 * generated from [SpeakRequest](../../../../contracts/rhapsode.types.ck#L142)
 */
export const SpeakRequest = z.strictObject({
    text: z.string().min(1),
    voice: z.string().optional(),
    variant: z.string().optional().describe('Absent means whatever is loaded.'),
    format: z.enum(['wav', 'mp3', 'opus', 'flac', 'pcm']).optional(),
    language: z.string().optional().describe("From the effective variant's `languages`."),
    delivery: z.enum(['hushed', 'frantic']).optional().describe('Closed, and deliberately has no word for "ordinary".'),
    params: z
        .record(
            z.string(),
            z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number()),
        )
        .optional()
        .describe("Validated against the effective variant's dials."),
    seed: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int()).optional(),
    stream: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()).optional(),
});
export type SpeakRequest = z.infer<typeof SpeakRequest>;

/**
 * One speaker's line in a conversation. `speaker` is a label the request makes up, not a voice.
 * generated from [DialogueTurn](../../../../contracts/rhapsode.types.ck#L162)
 */
export const DialogueTurn = z.strictObject({
    speaker: z.string().min(1),
    text: z.string().min(1),
});
export type DialogueTurn = z.infer<typeof DialogueTurn>;

/**
 * generated from [LoadRequest](../../../../contracts/rhapsode.types.ck#L185)
 */
export const LoadRequest = z.strictObject({
    variant: z.string().optional(),
});
export type LoadRequest = z.infer<typeof LoadRequest>;

/**
 * Required, unlike a load's: there is no "whatever is loaded" to fall back on for weights that are
 * not loaded yet. protocol.md § 8.
 * generated from [FetchRequest](../../../../contracts/rhapsode.types.ck#L191)
 */
export const FetchRequest = z.strictObject({
    variant: z.string(),
});
export type FetchRequest = z.infer<typeof FetchRequest>;

/**
 * `retryable` is a field rather than something the client infers from the status, because the
 * distinction that matters is between "this request was wrong" and "this request was fine and the
 * server was not". A caller that conflates them either retries a permanent failure forever or
 * discards work that would have succeeded on the next pass.
 * generated from [ErrorDetail](../../../../contracts/rhapsode.types.ck#L203)
 */
export const ErrorDetail = z.looseObject({
    code: z
        .enum([
            'bad_request',
            'unknown_engine',
            'unknown_voice',
            'unsupported',
            'model_unavailable',
            'oom',
            'overloaded',
            'internal',
            'forbidden',
            'conflict',
        ])
        .describe(
            'A closed set that § 9 grows at the end. A reader that meets a code from a newer contract must\nnot lose the envelope over it: `message` and `retryable` are the two fields that decide what\nthe caller does next, and they parse fine. The core falls back to `internal` for the code and\nkeeps the rest, rather than reporting a parse failure in place of the real error.',
        ),
    message: z.string(),
    retryable: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()),
});
export type ErrorDetail = z.infer<typeof ErrorDetail>;

/**
 * generated from [WorkerHealth](../../../../contracts/rhapsode.types.ck#L221)
 */
export const WorkerHealth = z.looseObject({
    process: z.enum(['up', 'draining']),
    model: z.enum(['unloaded', 'loading', 'loaded', 'unloading']),
    variant: z.string().optional(),
    device: z.string().optional(),
    vramBytes: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int())
        .optional()
        .describe('What the card holds in total.'),
    modelBytes: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int())
        .optional()
        .describe('What the loaded model took of it, measured. § 3.'),
});
export type WorkerHealth = z.infer<typeof WorkerHealth>;

/**
 * generated from [ResidencySummary](../../../../contracts/rhapsode.types.ck#L241)
 */
export const ResidencySummary = z.looseObject({
    resident: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int()),
    max: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int()),
    waiting: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int()),
    blockedBy: z.string().optional().describe('Named, because a wait at maxResidentModels 1 looks exactly like a hang.'),
});
export type ResidencySummary = z.infer<typeof ResidencySummary>;

/**
 * One model on the card, and what the core knows about it. protocol.md § 3.
 * generated from [ResidentModel](../../../../contracts/rhapsode.types.ck#L249)
 */
export const ResidentModel = z.looseObject({
    engine: z.string(),
    variant: z.string(),
    leases: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int())
        .describe('Requests still speaking it. A model with leases is not evictable.'),
    lastUsedAt: z.string().describe('ISO 8601, UTC.'),
    expiresAt: z.string().optional().describe('Absent while it is speaking, or when its keep-alive says never.'),
    keepAliveSeconds: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int())
        .describe('The one in force here: request, then engine, then server.'),
    sizeBytes: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int())
        .optional()
        .describe('What the worker measured the model taking, where it could.'),
});
export type ResidentModel = z.infer<typeof ResidentModel>;

/**
 * generated from [PullRequest](../../../../contracts/rhapsode.types.ck#L299)
 */
export const PullRequest = z.strictObject({
    variant: z.string().optional().describe("Absent means the engine's default variant."),
});
export type PullRequest = z.infer<typeof PullRequest>;

/**
 * One event on a job's stream, `GET /installs/{job}/events`. The shape is ServerKit's server feed,
 * declared here so a client can parse it without depending on ServerKit.
 * generated from [FeedProgress](../../../../contracts/rhapsode.types.ck#L305)
 */
export const FeedProgress = z.looseObject({
    phase: z.string().describe("The job's step."),
    index: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int()),
    total: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int()),
    status: z.enum(['running', 'done', 'failed']),
});
export type FeedProgress = z.infer<typeof FeedProgress>;

/**
 * What one build of an engine can perform. Capabilities depend on which build is loaded, which is
 * the whole reason this document has two levels: chatterbox `turbo` performs the paralinguistic
 * tags and discards the dials, while `original` is the other way round.
 * generated from [Variant](../../../../contracts/rhapsode.types.ck#L24)
 */
export const Variant = z.looseObject({
    cues: z.array(z.string()).describe('A subset of the standard vocabulary, § 5.'),
    deliveries: z.array(z.string()).describe('Ditto. Not an enum: § 9 forbids failing on an unknown one.'),
    dials: z.record(z.string(), Dial).describe('Engine-specific numbers, named by the adapter.'),
    languages: z.array(z.string()).optional(),
    maxCharacters: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int())
        .optional()
        .describe("Overrides the engine's own ceiling for this build."),
    cloning: Cloning.optional().describe('Optional only because contract 1 shipped without it. § 4.'),
    blending: Blending.optional().describe('Beside cloning, for the same reason: it needs no model. § 7.'),
    segmentation: Segmentation.optional().describe('Whether long text is split into several generations. § 8.'),
    dialogue: Dialogue.optional().describe('Present only where this build answers /dialogue. § 6.'),
});
export type Variant = z.infer<typeof Variant>;

/**
 * generated from [EngineSummary](../../../../contracts/rhapsode.types.ck#L230)
 */
export const EngineSummary = z.looseObject({
    id: z.string(),
    displayName: z.string(),
    license: License,
    process: z.enum(['down', 'starting', 'up', 'draining', 'failed']),
    model: z.enum(['unloaded', 'loading', 'loaded', 'unloading']),
    variant: z.string().optional(),
    lastError: z.string().optional(),
    restarts: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int()),
});
export type EngineSummary = z.infer<typeof EngineSummary>;

/**
 * What exists, installed or not. `/engines` is what this box has; this is what it could have, with
 * both licences, because the weights licence is only worth reading before the install.
 * generated from [CatalogEntry](../../../../contracts/rhapsode.types.ck#L276)
 */
export const CatalogEntry = z.looseObject({
    id: z.string(),
    displayName: z.string(),
    license: License,
    package: z.string().describe('The Python distribution the installer installs.'),
    defaultVariant: z.string().optional(),
    installed: z.enum(['no', 'installing', 'yes']),
    managed: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .describe('Installed through the API, so removable by it.'),
});
export type CatalogEntry = z.infer<typeof CatalogEntry>;

/**
 * The public shape, which the worker's `/speak` does not share: `keepAliveSeconds` is core policy
 * and a worker has no opinion about how long anything stays resident. protocol.md § 3.
 * generated from [EngineSpeakRequest](../../../../contracts/rhapsode.types.ck#L156)
 */
export const EngineSpeakRequest = SpeakRequest.extend({
    engine: z.string(),
    keepAliveSeconds: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(-1))
        .optional()
        .describe('-1 never expires, 0 frees on release.'),
});
export type EngineSpeakRequest = z.infer<typeof EngineSpeakRequest>;

/**
 * A conversation in one take. protocol.md § 6. `/speak`'s fields except `text`, `voice` and
 * `delivery`: a delivery reads a whole line one way, and a dialogue has more than one reader.
 * generated from [DialogueRequest](../../../../contracts/rhapsode.types.ck#L169)
 */
export const DialogueRequest = z.strictObject({
    turns: z.array(DialogueTurn),
    voices: z.record(z.string(), z.string()).optional().describe('Speaker label to voice id.'),
    variant: z.string().optional(),
    format: z.enum(['wav', 'mp3', 'opus', 'flac', 'pcm']).optional(),
    language: z.string().optional(),
    params: z
        .record(
            z.string(),
            z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number()),
        )
        .optional(),
    seed: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int()).optional(),
    stream: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()).optional(),
});
export type DialogueRequest = z.infer<typeof DialogueRequest>;

/**
 * generated from [ErrorBody](../../../../contracts/rhapsode.types.ck#L213)
 */
export const ErrorBody = z.looseObject({
    error: ErrorDetail,
});
export type ErrorBody = z.infer<typeof ErrorBody>;

/**
 * generated from [InstallJob](../../../../contracts/rhapsode.types.ck#L286)
 */
export const InstallJob = z.looseObject({
    id: z.string(),
    engine: z.string(),
    kind: z.enum(['install', 'pull']),
    variant: z.string().optional().describe('What a pull fetches, or an install fetches in step 5.'),
    state: z.enum(['queued', 'running', 'succeeded', 'failed']),
    step: z.enum(['venv', 'packages', 'verify', 'register', 'weights']).optional(),
    createdAt: z.string().describe('ISO 8601, UTC.'),
    startedAt: z.string().optional(),
    finishedAt: z.string().optional(),
    error: ErrorDetail.optional().describe('Present exactly when `state` is `failed`.'),
});
export type InstallJob = z.infer<typeof InstallJob>;

/**
 * generated from [ResidencyDetail](../../../../contracts/rhapsode.types.ck#L259)
 */
export const ResidencyDetail = ResidencySummary.extend({
    models: z.array(ResidentModel),
});
export type ResidencyDetail = z.infer<typeof ResidencyDetail>;

/**
 * generated from [FeedEvent](../../../../contracts/rhapsode.types.ck#L312)
 */
export const FeedEvent = z.looseObject({
    id: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int()).describe('The Last-Event-ID resume key.'),
    ts: z.string(),
    source: z.string(),
    level: z.enum(['debug', 'info', 'warn', 'error']),
    kind: z.enum(['progress', 'status', 'log', 'error', 'heartbeat']),
    message: z.string().optional(),
    correlationId: z.string().optional().describe('The job id.'),
    progress: FeedProgress.optional(),
    data: _ZodJson.optional(),
});
export type FeedEvent = z.infer<typeof FeedEvent>;

/**
 * The resident build, and everything true only while it is resident. Absent from the capability
 * document entirely when nothing is loaded, because a worker in up(unloaded) has nothing to
 * describe and an invented answer is worse than no answer.
 * generated from [CurrentVariant](../../../../contracts/rhapsode.types.ck#L76)
 */
export const CurrentVariant = Variant.extend({
    variant: z.string(),
    cloning: Cloning,
    blending: Blending.optional().describe('Absent means no, so a worker that predates it is read correctly.'),
    streaming: Streaming,
    nativeFormat: NativeFormat,
});
export type CurrentVariant = z.infer<typeof CurrentVariant>;

/**
 * generated from [CoreHealth](../../../../contracts/rhapsode.types.ck#L263)
 */
export const CoreHealth = z.looseObject({
    contract: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int()),
    status: z.enum(['ok', 'degraded']),
    engines: z.array(EngineSummary),
    residency: ResidencySummary,
});
export type CoreHealth = z.infer<typeof CoreHealth>;

/**
 * As `EngineSpeakRequest` is to `SpeakRequest`, and for the same reason.
 * generated from [EngineDialogueRequest](../../../../contracts/rhapsode.types.ck#L181)
 */
export const EngineDialogueRequest = DialogueRequest.extend({
    keepAliveSeconds: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(-1)).optional(),
});
export type EngineDialogueRequest = z.infer<typeof EngineDialogueRequest>;

/**
 * generated from [Capabilities](../../../../contracts/rhapsode.types.ck#L107)
 */
export const Capabilities = z.looseObject({
    contract: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int())
        .describe('The contract major this worker settled on. § 9.'),
    engine: EngineIdentity,
    license: License,
    device: Device,
    current: CurrentVariant.optional(),
    variants: z.record(z.string(), Variant),
    formats: z.array(z.string()).describe('What this worker can actually encode, here and now.'),
});
export type Capabilities = z.infer<typeof Capabilities>;
