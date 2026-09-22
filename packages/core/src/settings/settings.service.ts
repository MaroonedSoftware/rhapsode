import { nestKeys } from '@maroonedsoftware/appconfig';
import type { Logger } from '@maroonedsoftware/logger';
import type { SettingField, Settings, SettingsValues } from '@rhapsode/contract';

import { DEFAULTS, ENGINE_SETTINGS, SETTINGS, type RhapsodeConfig, type SettingApplies } from '../config.js';
import { resolveInstallSettings } from '../install/install.settings.js';
import { EngineRegistry } from '../registry/engine.registry.js';
import type { ResidencyPolicy } from '../residency/residency.manager.js';
import { residencyPolicyFrom } from '../residency/residency.policy.js';
import type { StateStore } from '../state/state.store.js';
import { resolveUpdateSettings, type UpdateSettings } from '../update/update.settings.js';
import { defaultSocketDir } from '../workers/worker.handle.js';
import { resolveWorkerOptions } from '../workers/worker.module.js';

/**
 * Every setting: what the running process uses, where each came from, and what waits for a restart.
 * protocol.md § 10, "Settings".
 *
 * It owns the two objects the live settings live in, `residencyPolicy` and `update`, and the
 * residency manager and the update checker hold those objects rather than copies. That is what lets a
 * setting apply without a restart while neither of them knows settings exist: both already read
 * their policy at the moment they use it.
 */
export class SettingsService {
    readonly residencyPolicy: ResidencyPolicy;
    readonly update: UpdateSettings;
    private readonly booted: RhapsodeConfig;

    constructor(
        /** Absent for a server built without one, whose settings are only ever its defaults and file. */
        private readonly store: StateStore | undefined,
        /** The operator's file on its own, which is how a value is known to have come from it. */
        private readonly operator: RhapsodeConfig,
        /** Everything the server was built from: the file with the database over it. */
        boot: RhapsodeConfig,
        private readonly engines: EngineRegistry,
        logger: Logger,
        private readonly env: NodeJS.ProcessEnv = process.env,
    ) {
        this.booted = boot;
        this.residencyPolicy = residencyPolicyFrom(boot, logger);
        this.update = resolveUpdateSettings(boot, env);
    }

    document(): Settings {
        const running = this.running();
        // What the next start would use: the file with the database over it as it stands now. A
        // setting that waits for a restart differs between the two until then.
        const next = valuesOf(overlay(this.operator, nestKeys(Object.fromEntries(this.store?.settings() ?? []), '.')), this.env);

        const fields: SettingField[] = Object.entries(SETTINGS).map(([key, applies]) => this.field(key, applies, running, next));
        for (const id of this.engines.ids().sort()) {
            for (const [name, applies] of Object.entries(ENGINE_SETTINGS)) {
                fields.push(this.field(`engines.${id}.${name}`, applies, running, next));
            }
        }
        return { values: running.values, fields };
    }

    /** Restart settings as the server was built, live ones as they are now. */
    private running(): Resolved {
        const resolved = valuesOf(this.booted, this.env);
        resolved.values.residency = { ...this.residencyPolicy };
        resolved.values.update = { check: this.update.check };
        for (const id of this.engines.ids().sort()) {
            const keepAliveSeconds = this.engines.entry(id)?.keepAliveSeconds;
            resolved.values.engines[id] = keepAliveSeconds === undefined ? {} : { keepAliveSeconds };
        }
        return resolved;
    }

    private field(key: string, applies: SettingApplies, running: Resolved, next: Resolved): SettingField {
        const field: SettingField = { key, source: this.source(key), applies };
        if (applies !== 'restart') return field;

        // The token is compared and never shown: `true` says a new one is waiting, and nothing more.
        if (key === 'management.token') {
            if (running.token !== next.token) field.saved = true;
            return field;
        }
        const waiting = pathOf(next.values, key);
        if (waiting !== undefined && JSON.stringify(waiting) !== JSON.stringify(pathOf(running.values, key))) {
            field.saved = waiting as SettingField['saved'];
        }
        return field;
    }

    private source(key: string): SettingField['source'] {
        if (this.store?.setting(key) !== undefined) return 'database';
        if (pathOf(this.operator, key) != undefined) return 'config';
        // The two spellings keepAliveSeconds replaced are still read from the file, so they are
        // still the file's value. § 3.
        const residency = this.operator.residency;
        if (
            key === 'residency.keepAliveSeconds' &&
            (typeof residency?.idleTerminateSeconds === 'number' || typeof residency?.idleUnloadSeconds === 'number')
        ) {
            return 'config';
        }
        return 'default';
    }
}

interface Resolved {
    values: SettingsValues;
    /** Kept beside the values rather than in them, so it cannot reach a response by accident. */
    token?: string;
}

/** Every server-wide setting, with its default filled in, from the modules that use it. */
function valuesOf(config: RhapsodeConfig, env: NodeJS.ProcessEnv): Resolved {
    const workers = resolveWorkerOptions(config);
    const install = resolveInstallSettings(config, env);
    // An empty token is none, as the management module reads it.
    const token = typeof config.management?.token === 'string' && config.management.token !== '' ? config.management.token : undefined;

    return {
        token,
        values: {
            server: {
                port: config.server?.port ?? DEFAULTS.port,
                host: config.server?.host ?? DEFAULTS.host,
                shutdownGraceMs: config.server?.shutdownGraceMs ?? DEFAULTS.shutdownGraceMs,
            },
            log: { level: (config.log?.level ?? DEFAULTS.logLevel) as SettingsValues['log']['level'] },
            residency: { ...residencyPolicyFrom(config) },
            workers: {
                socketDir: workers.socketDir ?? defaultSocketDir(),
                voiceDir: workers.voiceDir ?? '',
                startupTimeoutSeconds: workers.startupTimeoutSeconds,
                drainGraceMs: workers.drainGraceMs,
                maxRestarts: workers.maxRestarts,
                restartDecaySeconds: workers.restartDecaySeconds,
            },
            install: {
                venvDir: install.venvDir,
                ...(install.sourceDir === undefined ? {} : { sourceDir: install.sourceDir }),
                python: install.python,
            },
            management: { tokenSet: token !== undefined, origins: config.management?.origins ?? [] },
            update: { check: resolveUpdateSettings(config, env).check },
            engines: {},
        },
    };
}

/** A dotted key's value in a document, or `undefined` where any step of it is missing. */
function pathOf(document: unknown, key: string): unknown {
    let at = document;
    for (const step of key.split('.')) {
        if (at === null || typeof at !== 'object') return undefined;
        at = (at as Record<string, unknown>)[step];
    }
    return at;
}

/** `top` over `base`, object by object; anything else in `top`, arrays included, replaces. */
function overlay<T>(base: T, top: Record<string, unknown>): T {
    const merged: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    for (const [key, value] of Object.entries(top)) {
        const below = merged[key];
        merged[key] = isObject(value) && isObject(below) ? overlay(below, value) : value;
    }
    return merged as T;
}

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
