import type { EngineEntry } from './registry/engine.registry.js';

/** What this box has, as distinct from what exists. See `EngineRegistry`. */
export interface RhapsodeConfig {
    server?: {
        port?: number;
        host?: string;
        /**
         * Must be comfortably larger than a worker's own drain grace, because every module's
         * shutdown hook is awaited before the process exits. Equal values produce a shutdown that
         * looks hung to an operator.
         */
        shutdownGraceMs?: number;
    };
    log?: { level?: string };
    residency?: {
        /** One is the right answer for one GPU, which is why it is the default. § 3. */
        maxResidentModels?: number;
        evictionWaitSeconds?: number;
        /**
         * How long a model with nothing to do stays on the card, five minutes by default. `-1`
         * keeps it until something else needs the room, `0` frees it as soon as the last request
         * lets go. § 3.
         */
        keepAliveSeconds?: number;
        /**
         * @deprecated Both are read as `keepAliveSeconds` when it is not set, and an expiry now
         * terminates whichever of them named it. Say `-1` for what absent used to mean.
         */
        idleUnloadSeconds?: number;
        /** @deprecated See `idleUnloadSeconds`. */
        idleTerminateSeconds?: number;
    };
    workers?: {
        socketDir?: string;
        /** Where each local worker keeps its voices, as `<voiceDir>/<engine>`. Default `~/.rhapsode/voices`. */
        voiceDir?: string;
        startupTimeoutSeconds?: number;
        drainGraceMs?: number;
        maxRestarts?: number;
        restartDecaySeconds?: number;
    };
    /** protocol.md § 10. */
    management?: {
        /**
         * Admits a caller from anywhere that presents it as a bearer token. Without it, management
         * routes answer loopback callers only. They run pip, so this is a root password for the box.
         */
        token?: string;
        /**
         * Browser origins, besides this machine's own, whose pages may call management routes. A
         * page from anywhere else is refused whatever else is true of the request.
         */
        origins?: string[];
    };
    /** protocol.md § 10. */
    install?: {
        /** Each installed engine gets `<venvDir>/<id>`. Default `~/.rhapsode/venvs`. */
        venvDir?: string;
        /**
         * Where adapter sources are looked for before the package index. Default: the `python/`
         * directory of the checkout this core is running from, when there is one.
         */
        sourceDir?: string;
        /** The interpreter that creates each virtualenv. Default `python3`. */
        python?: string;
    };
    /** protocol.md § 9. */
    update?: {
        /**
         * Whether `GET /update` asks GitHub for the latest release, at most once a day and only when
         * asked. On by default. `RHAPSODE_UPDATE_CHECK=0` turns it off from the environment.
         */
        check?: boolean;
    };
    engines?: Record<
        string,
        Partial<EngineEntry> & {
            enabled?: boolean;
            /**
             * The weights licence the last install or reinstall accepted. The core records it in the
             * state database for a reinstall to read, and boot ignores it. protocol.md § 10.
             */
            accepted?: string;
        }
    >;
}

export const DEFAULTS = {
    port: 8080,
    host: '::',
    logLevel: 'info',
    shutdownGraceMs: 20_000,
    maxResidentModels: 1,
    evictionWaitSeconds: 30,
    keepAliveSeconds: 300,
    startupTimeoutSeconds: 60,
    drainGraceMs: 10_000,
    maxRestarts: 5,
    restartDecaySeconds: 300,
} as const;

/** Whether a change to a setting takes effect when it is written, or at the next start. § 10. */
export type SettingApplies = 'live' | 'restart';

/**
 * Every server-wide setting `/settings` reads and writes, by dotted key. protocol.md § 10, "Settings".
 *
 * The one list: the settings document, the patch's validation and the wizard's table are all drawn
 * from it, so a setting cannot be readable in one and missing from another. A setting is `live` only
 * where the core reads it at the moment it uses it; the spec says why each of the rest waits.
 */
export const SETTINGS: Readonly<Record<string, SettingApplies>> = {
    'server.port': 'restart',
    'server.host': 'restart',
    'server.shutdownGraceMs': 'restart',
    'log.level': 'restart',
    'residency.maxResidentModels': 'live',
    'residency.evictionWaitSeconds': 'live',
    'residency.keepAliveSeconds': 'live',
    'workers.socketDir': 'restart',
    'workers.voiceDir': 'restart',
    'workers.startupTimeoutSeconds': 'restart',
    'workers.drainGraceMs': 'restart',
    'workers.maxRestarts': 'restart',
    'workers.restartDecaySeconds': 'restart',
    'install.venvDir': 'restart',
    'install.sourceDir': 'restart',
    'install.python': 'restart',
    'management.token': 'restart',
    'management.origins': 'restart',
    'update.check': 'live',
};

/** The settings each engine has, under `engines.<id>.`. The engine's entry itself is not one. */
export const ENGINE_SETTINGS: Readonly<Record<string, SettingApplies>> = {
    keepAliveSeconds: 'live',
};
