import { z } from 'zod';

type _JsonValue = string | number | boolean | null | _JsonValue[] | { [key: string]: _JsonValue };
const _ZodJson: z.ZodType<_JsonValue> = z.lazy(() =>
    z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(_ZodJson), z.record(z.string(), _ZodJson)]),
);

/**
 * generated from [ApiInfo](../../../../contracts/rhapsode.public.ck#L63)
 */
export const ApiInfo = z.looseObject({
    title: z.string(),
    version: z.string().describe("The running core's package version. Not the contract."),
});
export type ApiInfo = z.infer<typeof ApiInfo>;

/**
 * generated from [SettingsServer](../../../../contracts/rhapsode.public.ck#L402)
 */
export const SettingsServer = z.looseObject({
    port: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int()),
    host: z.string(),
    shutdownGraceMs: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int()),
});
export type SettingsServer = z.infer<typeof SettingsServer>;

/**
 * generated from [SettingsLog](../../../../contracts/rhapsode.public.ck#L408)
 */
export const SettingsLog = z.looseObject({
    level: z.enum(['error', 'warn', 'info', 'debug', 'trace']),
});
export type SettingsLog = z.infer<typeof SettingsLog>;

/**
 * generated from [SettingsResidency](../../../../contracts/rhapsode.public.ck#L412)
 */
export const SettingsResidency = z.looseObject({
    maxResidentModels: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int()),
    evictionWaitSeconds: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int()),
    keepAliveSeconds: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int()),
});
export type SettingsResidency = z.infer<typeof SettingsResidency>;

/**
 * generated from [SettingsWorkers](../../../../contracts/rhapsode.public.ck#L418)
 */
export const SettingsWorkers = z.looseObject({
    socketDir: z.string(),
    voiceDir: z.string(),
    startupTimeoutSeconds: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int()),
    drainGraceMs: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int()),
    maxRestarts: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int()),
    restartDecaySeconds: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int()),
});
export type SettingsWorkers = z.infer<typeof SettingsWorkers>;

/**
 * generated from [SettingsInstall](../../../../contracts/rhapsode.public.ck#L427)
 */
export const SettingsInstall = z.looseObject({
    venvDir: z.string(),
    sourceDir: z.string().optional().describe('Absent when there is neither a setting nor a checkout to find.'),
    python: z.string(),
});
export type SettingsInstall = z.infer<typeof SettingsInstall>;

/**
 * generated from [SettingsManagement](../../../../contracts/rhapsode.public.ck#L433)
 */
export const SettingsManagement = z.looseObject({
    tokenSet: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .describe('Never the token itself, which is a root password for the box.'),
    origins: z.array(z.string()),
});
export type SettingsManagement = z.infer<typeof SettingsManagement>;

/**
 * generated from [SettingsUpdate](../../../../contracts/rhapsode.public.ck#L438)
 */
export const SettingsUpdate = z.looseObject({
    check: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()),
});
export type SettingsUpdate = z.infer<typeof SettingsUpdate>;

/**
 * generated from [SettingsEngine](../../../../contracts/rhapsode.public.ck#L442)
 */
export const SettingsEngine = z.looseObject({
    keepAliveSeconds: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int())
        .optional()
        .describe('Absent when the engine uses residency.keepAliveSeconds.'),
});
export type SettingsEngine = z.infer<typeof SettingsEngine>;

/**
 * generated from [SettingField](../../../../contracts/rhapsode.public.ck#L458)
 */
export const SettingField = z.looseObject({
    key: z.string().describe('Dotted: residency.keepAliveSeconds, engines.kokoro.keepAliveSeconds.'),
    source: z.enum(['default', 'config', 'database']).describe('The layer the value in use came from.'),
    applies: z.enum(['live', 'restart']).describe('Whether a change takes effect when it is written.'),
    saved: _ZodJson.optional().describe('A value waiting for a restart. For management.token, `true` and never the token.'),
});
export type SettingField = z.infer<typeof SettingField>;

/**
 * This file, `rhapsode.types.ck` and `rhapsode.openai.ck` as OpenAPI 3.1. protocol.md § 9. Only the
 * top of the document is declared: the rest is OpenAPI's own shape, and a client that wants it typed
 * already has a library that types it.
 * generated from [OpenApiDocument](../../../../contracts/rhapsode.public.ck#L56)
 */
export const OpenApiDocument = z.looseObject({
    openapi: z.string(),
    info: ApiInfo,
    paths: z.record(z.string(), _ZodJson),
    components: z.record(z.string(), _ZodJson).optional(),
});
export type OpenApiDocument = z.infer<typeof OpenApiDocument>;

/**
 * What the running process is using. A setting waiting for a restart shows its old value here.
 * generated from [SettingsValues](../../../../contracts/rhapsode.public.ck#L447)
 */
export const SettingsValues = z.looseObject({
    server: SettingsServer,
    log: SettingsLog,
    residency: SettingsResidency,
    workers: SettingsWorkers,
    install: SettingsInstall,
    management: SettingsManagement,
    update: SettingsUpdate,
    engines: z.record(z.string(), SettingsEngine).describe('One per engine in the registry.'),
});
export type SettingsValues = z.infer<typeof SettingsValues>;

/**
 * generated from [Settings](../../../../contracts/rhapsode.public.ck#L465)
 */
export const Settings = z.looseObject({
    values: SettingsValues,
    fields: z.array(SettingField),
});
export type Settings = z.infer<typeof Settings>;
