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
        /** Both off by default: they trade a cold start for memory nobody is asking for. */
        idleUnloadSeconds?: number;
        idleTerminateSeconds?: number;
    };
    workers?: {
        socketDir?: string;
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
    engines?: Record<string, Partial<EngineEntry> & { enabled?: boolean }>;
}

export const DEFAULTS = {
    port: 8080,
    shutdownGraceMs: 20_000,
    maxResidentModels: 1,
    evictionWaitSeconds: 30,
    startupTimeoutSeconds: 60,
    drainGraceMs: 10_000,
    maxRestarts: 5,
    restartDecaySeconds: 300,
} as const;
