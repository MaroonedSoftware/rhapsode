import { z } from 'zod';

const _ZodBinary = z.custom<Buffer>(val => Buffer.isBuffer(val), { error: 'Must be binary data' });

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
 * generated from [Cloning](../../../../contracts/rhapsode.types.ck#L32)
 */
export const Cloning = z.looseObject({
    supported: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()),
    referenceSeconds: z
        .array(z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number()))
        .optional()
        .describe('[min, max] of usable reference audio.'),
    formats: z.array(z.string()).optional(),
});
export type Cloning = z.infer<typeof Cloning>;

/**
 * generated from [Streaming](../../../../contracts/rhapsode.types.ck#L38)
 */
export const Streaming = z.looseObject({
    supported: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()),
    granularity: z.enum(['chunk', 'sentence']).optional(),
});
export type Streaming = z.infer<typeof Streaming>;

/**
 * generated from [NativeFormat](../../../../contracts/rhapsode.types.ck#L43)
 */
export const NativeFormat = z.looseObject({
    encoding: z.string().describe('v1 accepts pcm_s16le and nothing else.'),
    sampleRate: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int()),
    channels: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int()),
});
export type NativeFormat = z.infer<typeof NativeFormat>;

/**
 * generated from [EngineIdentity](../../../../contracts/rhapsode.types.ck#L59)
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
 * generated from [License](../../../../contracts/rhapsode.types.ck#L69)
 */
export const License = z.looseObject({
    code: z.string(),
    weights: z.string(),
    weightsCommercialUse: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()),
    notes: z.string().optional(),
});
export type License = z.infer<typeof License>;

/**
 * generated from [Device](../../../../contracts/rhapsode.types.ck#L76)
 */
export const Device = z.looseObject({
    type: z.enum(['cuda', 'rocm', 'mps', 'cpu']),
    name: z.string(),
    vramBytes: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int()).optional(),
});
export type Device = z.infer<typeof Device>;

/**
 * generated from [Voice](../../../../contracts/rhapsode.types.ck#L96)
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
 * generated from [CreateVoiceForm](../../../../contracts/rhapsode.types.ck#L105)
 */
export const CreateVoiceForm = z.strictObject({
    id: z.string(),
    label: z.string().optional(),
    reference: _ZodBinary,
});
export type CreateVoiceForm = z.infer<typeof CreateVoiceForm>;

/**
 * generated from [SpeakRequest](../../../../contracts/rhapsode.types.ck#L115)
 */
export const SpeakRequest = z.strictObject({
    text: z.string().min(1),
    voice: z.string().optional(),
    variant: z.string().optional().describe('Absent means whatever is loaded.'),
    format: z.enum(['wav', 'mp3', 'opus', 'flac', 'pcm']).optional(),
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
 * generated from [LoadRequest](../../../../contracts/rhapsode.types.ck#L130)
 */
export const LoadRequest = z.strictObject({
    variant: z.string().optional(),
});
export type LoadRequest = z.infer<typeof LoadRequest>;

/**
 * `retryable` is a field rather than something the client infers from the status, because the
 * distinction that matters is between "this request was wrong" and "this request was fine and the
 * server was not". A caller that conflates them either retries a permanent failure forever or
 * discards work that would have succeeded on the next pass.
 * generated from [ErrorDetail](../../../../contracts/rhapsode.types.ck#L142)
 */
export const ErrorDetail = z.looseObject({
    code: z
        .enum(['bad_request', 'unknown_engine', 'unknown_voice', 'unsupported', 'model_unavailable', 'oom', 'overloaded', 'internal'])
        .describe(
            'A closed set that § 9 grows at the end. A reader that meets a code from a newer contract must\nnot lose the envelope over it: `message` and `retryable` are the two fields that decide what\nthe caller does next, and they parse fine. The core falls back to `internal` for the code and\nkeeps the rest, rather than reporting a parse failure in place of the real error.',
        ),
    message: z.string(),
    retryable: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()),
});
export type ErrorDetail = z.infer<typeof ErrorDetail>;

/**
 * generated from [WorkerHealth](../../../../contracts/rhapsode.types.ck#L160)
 */
export const WorkerHealth = z.looseObject({
    process: z.enum(['up', 'draining']),
    model: z.enum(['unloaded', 'loading', 'loaded', 'unloading']),
    variant: z.string().optional(),
    device: z.string().optional(),
    vramBytes: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int()).optional(),
});
export type WorkerHealth = z.infer<typeof WorkerHealth>;

/**
 * generated from [ResidencySummary](../../../../contracts/rhapsode.types.ck#L179)
 */
export const ResidencySummary = z.looseObject({
    resident: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int()),
    max: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int()),
    waiting: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int()),
    blockedBy: z.string().optional().describe('Named, because a wait at maxResidentModels 1 looks exactly like a hang.'),
});
export type ResidencySummary = z.infer<typeof ResidencySummary>;

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
});
export type Variant = z.infer<typeof Variant>;

/**
 * generated from [EngineSummary](../../../../contracts/rhapsode.types.ck#L168)
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
 * generated from [EngineSpeakRequest](../../../../contracts/rhapsode.types.ck#L126)
 */
export const EngineSpeakRequest = SpeakRequest.extend({
    engine: z.string(),
});
export type EngineSpeakRequest = z.infer<typeof EngineSpeakRequest>;

/**
 * generated from [ErrorBody](../../../../contracts/rhapsode.types.ck#L152)
 */
export const ErrorBody = z.looseObject({
    error: ErrorDetail,
});
export type ErrorBody = z.infer<typeof ErrorBody>;

/**
 * The resident build, and everything true only while it is resident. Absent from the capability
 * document entirely when nothing is loaded, because a worker in up(unloaded) has nothing to
 * describe and an invented answer is worse than no answer.
 * generated from [CurrentVariant](../../../../contracts/rhapsode.types.ck#L52)
 */
export const CurrentVariant = Variant.extend({
    variant: z.string(),
    cloning: Cloning,
    streaming: Streaming,
    nativeFormat: NativeFormat,
});
export type CurrentVariant = z.infer<typeof CurrentVariant>;

/**
 * generated from [CoreHealth](../../../../contracts/rhapsode.types.ck#L186)
 */
export const CoreHealth = z.looseObject({
    contract: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int()),
    status: z.enum(['ok', 'degraded']),
    engines: z.array(EngineSummary),
    residency: ResidencySummary,
});
export type CoreHealth = z.infer<typeof CoreHealth>;

/**
 * generated from [Capabilities](../../../../contracts/rhapsode.types.ck#L82)
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
