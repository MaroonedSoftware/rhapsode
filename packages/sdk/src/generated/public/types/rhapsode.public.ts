import type { JsonValue } from '../../sdk-options.js';

/**
 * generated from [ApiInfo](../../../../../../contracts/rhapsode.public.ck#L79)
 */
export interface ApiInfo {
    title: string;
    /** The running core's package version. Not the contract. */
    version: string;
}

/**
 * generated from [SettingsServer](../../../../../../contracts/rhapsode.public.ck#L437)
 */
export interface SettingsServer {
    port: number;
    host: string;
    shutdownGraceMs: number;
}

/**
 * generated from [SettingsLog](../../../../../../contracts/rhapsode.public.ck#L443)
 */
export interface SettingsLog {
    level: 'error' | 'warn' | 'info' | 'debug' | 'trace';
}

/**
 * generated from [SettingsResidency](../../../../../../contracts/rhapsode.public.ck#L447)
 */
export interface SettingsResidency {
    maxResidentModels: number;
    evictionWaitSeconds: number;
    keepAliveSeconds: number;
}

/**
 * generated from [SettingsWorkers](../../../../../../contracts/rhapsode.public.ck#L453)
 */
export interface SettingsWorkers {
    socketDir: string;
    voiceDir: string;
    startupTimeoutSeconds: number;
    drainGraceMs: number;
    maxRestarts: number;
    restartDecaySeconds: number;
}

/**
 * generated from [SettingsInstall](../../../../../../contracts/rhapsode.public.ck#L462)
 */
export interface SettingsInstall {
    venvDir: string;
    /** Absent when there is neither a setting nor a checkout to find. */
    sourceDir?: string;
    python: string;
}

/**
 * generated from [SettingsManagement](../../../../../../contracts/rhapsode.public.ck#L468)
 */
export interface SettingsManagement {
    /** Never the token itself, which is a root password for the box. */
    tokenSet: boolean;
    origins: string[];
}

/**
 * generated from [SettingsUpdate](../../../../../../contracts/rhapsode.public.ck#L473)
 */
export interface SettingsUpdate {
    check: boolean;
}

/**
 * generated from [SettingsEngine](../../../../../../contracts/rhapsode.public.ck#L477)
 */
export interface SettingsEngine {
    /** Absent when the engine uses residency.keepAliveSeconds. */
    keepAliveSeconds?: number;
}

/**
 * generated from [SettingField](../../../../../../contracts/rhapsode.public.ck#L493)
 */
export interface SettingField {
    /** Dotted: residency.keepAliveSeconds, engines.kokoro.keepAliveSeconds. */
    key: string;
    /** The layer the value in use came from. */
    source: 'default' | 'config' | 'database';
    /** Whether a change takes effect when it is written. */
    applies: 'live' | 'restart';
    /** A value waiting for a restart. For management.token, `true` and never the token. */
    saved?: JsonValue;
}

/**
 * A change to some settings. Strict, so a misspelt key is refused rather than saved and ignored, and
 * every member nullable: `null` clears the database's value and the file's, or the default, shows
 * through again. The ranges here are the ones a value is refused outside of; § 10 lists them.
 * generated from [SettingsServerPatch](../../../../../../contracts/rhapsode.public.ck#L508)
 */
export interface SettingsServerPatch {
    port?: number | null;
    host?: string | null;
    shutdownGraceMs?: number | null;
}

/**
 * generated from [SettingsLogPatch](../../../../../../contracts/rhapsode.public.ck#L514)
 */
export interface SettingsLogPatch {
    level?: 'error' | 'warn' | 'info' | 'debug' | 'trace' | null;
}

/**
 * generated from [SettingsResidencyPatch](../../../../../../contracts/rhapsode.public.ck#L518)
 */
export interface SettingsResidencyPatch {
    maxResidentModels?: number | null;
    evictionWaitSeconds?: number | null;
    keepAliveSeconds?: number | null;
}

/**
 * generated from [SettingsWorkersPatch](../../../../../../contracts/rhapsode.public.ck#L524)
 */
export interface SettingsWorkersPatch {
    socketDir?: string | null;
    voiceDir?: string | null;
    startupTimeoutSeconds?: number | null;
    drainGraceMs?: number | null;
    maxRestarts?: number | null;
    restartDecaySeconds?: number | null;
}

/**
 * generated from [SettingsInstallPatch](../../../../../../contracts/rhapsode.public.ck#L533)
 */
export interface SettingsInstallPatch {
    venvDir?: string | null;
    sourceDir?: string | null;
    python?: string | null;
}

/**
 * generated from [SettingsManagementPatch](../../../../../../contracts/rhapsode.public.ck#L539)
 */
export interface SettingsManagementPatch {
    /** Empty is no token, even where the file has one. */
    token?: string | null;
    /** The whole list, replacing the file's rather than adding to it. */
    origins?: string[] | null;
}

/**
 * generated from [SettingsUpdatePatch](../../../../../../contracts/rhapsode.public.ck#L544)
 */
export interface SettingsUpdatePatch {
    check?: boolean | null;
}

/**
 * generated from [SettingsEnginePatch](../../../../../../contracts/rhapsode.public.ck#L548)
 */
export interface SettingsEnginePatch {
    keepAliveSeconds?: number | null;
}

/**
 * This file, `rhapsode.types.ck` and `rhapsode.openai.ck` as OpenAPI 3.1. protocol.md § 9. Only the
 * top of the document is declared: the rest is OpenAPI's own shape, and a client that wants it typed
 * already has a library that types it.
 * generated from [OpenApiDocument](../../../../../../contracts/rhapsode.public.ck#L72)
 */
export interface OpenApiDocument {
    openapi: string;
    info: ApiInfo;
    paths: Record<string, JsonValue>;
    components?: Record<string, JsonValue>;
}

/**
 * What the running process is using. A setting waiting for a restart shows its old value here.
 * generated from [SettingsValues](../../../../../../contracts/rhapsode.public.ck#L482)
 */
export interface SettingsValues {
    server: SettingsServer;
    log: SettingsLog;
    residency: SettingsResidency;
    workers: SettingsWorkers;
    install: SettingsInstall;
    management: SettingsManagement;
    update: SettingsUpdate;
    /** One per engine in the registry. */
    engines: Record<string, SettingsEngine>;
}

/**
 * generated from [SettingsPatch](../../../../../../contracts/rhapsode.public.ck#L552)
 */
export interface SettingsPatch {
    server?: SettingsServerPatch;
    log?: SettingsLogPatch;
    residency?: SettingsResidencyPatch;
    workers?: SettingsWorkersPatch;
    install?: SettingsInstallPatch;
    management?: SettingsManagementPatch;
    update?: SettingsUpdatePatch;
    engines?: Record<string, SettingsEnginePatch>;
}

/**
 * generated from [Settings](../../../../../../contracts/rhapsode.public.ck#L500)
 */
export interface Settings {
    values: SettingsValues;
    fields: SettingField[];
}
