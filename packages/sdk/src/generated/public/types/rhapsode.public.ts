import type { JsonValue } from '../../sdk-options.js';

/**
 * generated from [ApiInfo](../../../../../../contracts/rhapsode.public.ck#L63)
 */
export interface ApiInfo {
    title: string;
    /** The running core's package version. Not the contract. */
    version: string;
}

/**
 * generated from [SettingsServer](../../../../../../contracts/rhapsode.public.ck#L402)
 */
export interface SettingsServer {
    port: number;
    host: string;
    shutdownGraceMs: number;
}

/**
 * generated from [SettingsLog](../../../../../../contracts/rhapsode.public.ck#L408)
 */
export interface SettingsLog {
    level: 'error' | 'warn' | 'info' | 'debug' | 'trace';
}

/**
 * generated from [SettingsResidency](../../../../../../contracts/rhapsode.public.ck#L412)
 */
export interface SettingsResidency {
    maxResidentModels: number;
    evictionWaitSeconds: number;
    keepAliveSeconds: number;
}

/**
 * generated from [SettingsWorkers](../../../../../../contracts/rhapsode.public.ck#L418)
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
 * generated from [SettingsInstall](../../../../../../contracts/rhapsode.public.ck#L427)
 */
export interface SettingsInstall {
    venvDir: string;
    /** Absent when there is neither a setting nor a checkout to find. */
    sourceDir?: string;
    python: string;
}

/**
 * generated from [SettingsManagement](../../../../../../contracts/rhapsode.public.ck#L433)
 */
export interface SettingsManagement {
    /** Never the token itself, which is a root password for the box. */
    tokenSet: boolean;
    origins: string[];
}

/**
 * generated from [SettingsUpdate](../../../../../../contracts/rhapsode.public.ck#L438)
 */
export interface SettingsUpdate {
    check: boolean;
}

/**
 * generated from [SettingsEngine](../../../../../../contracts/rhapsode.public.ck#L442)
 */
export interface SettingsEngine {
    /** Absent when the engine uses residency.keepAliveSeconds. */
    keepAliveSeconds?: number;
}

/**
 * generated from [SettingField](../../../../../../contracts/rhapsode.public.ck#L458)
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
 * This file, `rhapsode.types.ck` and `rhapsode.openai.ck` as OpenAPI 3.1. protocol.md § 9. Only the
 * top of the document is declared: the rest is OpenAPI's own shape, and a client that wants it typed
 * already has a library that types it.
 * generated from [OpenApiDocument](../../../../../../contracts/rhapsode.public.ck#L56)
 */
export interface OpenApiDocument {
    openapi: string;
    info: ApiInfo;
    paths: Record<string, JsonValue>;
    components?: Record<string, JsonValue>;
}

/**
 * What the running process is using. A setting waiting for a restart shows its old value here.
 * generated from [SettingsValues](../../../../../../contracts/rhapsode.public.ck#L447)
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
 * generated from [Settings](../../../../../../contracts/rhapsode.public.ck#L465)
 */
export interface Settings {
    values: SettingsValues;
    fields: SettingField[];
}
