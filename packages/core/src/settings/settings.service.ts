import { nestKeys } from '@maroonedsoftware/appconfig';
import type { Logger } from '@maroonedsoftware/logger';
import type { SettingField, Settings, SettingsPatch, SettingsValues } from '@rhapsode/contract';

import { DEFAULTS, ENGINE_SETTINGS, SETTINGS, type RhapsodeConfig, type SettingApplies } from '../config.js';
import { RhapsodeError } from '../errors/rhapsode.error.js';
import { resolveInstallSettings } from '../install/install.settings.js';
import { isLoopbackOrigin } from '../management/management.access.policy.js';
import { EngineRegistry } from '../registry/engine.registry.js';
import type { ResidencyManager, ResidencyPolicy } from '../residency/residency.manager.js';
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
        /** Late, because the residency manager is built from this service's policy. */
        private readonly residency: () => Pick<ResidencyManager, 'rearmExpiry'>,
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

    /**
     * Write a patch to the database, and apply at once the settings that can be. § 10.
     *
     * Everything that can be refused is refused before anything is written, and the write is one
     * transaction, so a refused patch changes nothing even where some of its keys were allowed.
     */
    async apply(patch: SettingsPatch, caller: SettingsCaller): Promise<void> {
        const store = this.store;
        if (store === undefined) {
            throw new RhapsodeError('unsupported', 'this server was started without a state database, so it has nowhere to keep a setting');
        }
        const changes = flatten(patch);
        if (changes.length === 0) return;

        for (const [key] of changes) {
            const engine = engineOf(key);
            if (engine !== undefined && !this.engines.has(engine)) throw RhapsodeError.unknownEngine(engine, this.engines.ids());
        }
        for (const origin of patch.management?.origins ?? []) {
            if (!isOrigin(origin)) {
                throw new RhapsodeError(
                    'bad_request',
                    `"${origin}" in management.origins is not an origin: that is a scheme, a host and a port, such as http://tower:8081, with nothing after them`,
                );
            }
        }
        this.refuseLockout(patch, caller, store, changes);

        store.transaction(() => {
            for (const [key, value] of changes) store.setSetting(key, value ?? undefined);
        });
        await this.applyLive(store, changes);
    }

    /**
     * A change after which its caller's next request would be refused. Judged on what the next
     * start would use, since both settings it covers wait for one. § 10.
     */
    private refuseLockout(patch: SettingsPatch, caller: SettingsCaller, store: StateStore, changes: Change[]): void {
        const pending = new Map(store.settings());
        for (const [key, value] of changes) {
            if (value === null) pending.delete(key);
            else pending.set(key, value);
        }
        const next = valuesOf(overlay(this.operator, nestKeys(Object.fromEntries(pending), '.')), this.env);

        // Only a token admits a caller from another machine, and without one the management routes
        // answer this machine alone.
        if (patch.management?.token !== undefined && !caller.local && next.token === undefined) {
            throw new RhapsodeError(
                'conflict',
                'a caller on another machine cannot leave this server without a management token: its next request would be refused. Do it from the machine running rhapsode',
            );
        }
        // A page on this machine is admitted by its origin whatever the list says.
        if (
            patch.management?.origins !== undefined &&
            caller.origin !== undefined &&
            !isLoopbackOrigin(caller.origin) &&
            !next.values.management.origins.includes(caller.origin)
        ) {
            throw new RhapsodeError(
                'conflict',
                `management.origins would no longer list ${caller.origin}, the page making this change, which would then be refused. Keep it in the list, or change it from another page`,
            );
        }
    }

    /**
     * The live settings from the database as it now stands, into the objects the residency manager
     * and the update checker hold. Setting all of them rather than the ones patched costs nothing,
     * and cannot leave one stale.
     */
    private async applyLive(store: StateStore, changes: Change[]): Promise<void> {
        const live = overlay(this.operator, nestKeys(Object.fromEntries(store.settings()), '.'));
        Object.assign(this.residencyPolicy, residencyPolicyFrom(live));
        // Through the resolver, so RHAPSODE_UPDATE_CHECK=0 still turns it off whatever was written. § 9.
        Object.assign(this.update, resolveUpdateSettings(live, this.env));

        let rearm = changes.some(([key]) => key === 'residency.keepAliveSeconds');
        for (const engine of new Set(changes.map(([key]) => engineOf(key)).filter(id => id !== undefined))) {
            // The database, then the operator's entry, then what the install recorded: the order the
            // engine's entry was merged in at boot.
            const seconds =
                store.setting(`engines.${engine}.keepAliveSeconds`) ??
                this.operator.engines?.[engine]?.keepAliveSeconds ??
                store.engine(engine)?.keepAliveSeconds;
            this.engines.retune(engine, typeof seconds === 'number' ? seconds : undefined);
            rearm = true;
        }
        if (rearm) await this.residency().rearmExpiry();
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

/** What the lockout rules need to know about who is asking. § 10. */
export interface SettingsCaller {
    /** On this machine, as the management guard decides it. */
    local: boolean;
    /** The page's `Origin`, when a browser sent one. */
    origin?: string;
}

/** One setting a patch names, by dotted key; `null` clears it from the database. */
type Change = [key: string, value: unknown];

/** A patch as the settings it names. A group or engine the patch leaves out names nothing. */
function flatten(patch: SettingsPatch): Change[] {
    const changes: Change[] = [];
    for (const [group, members] of Object.entries(patch)) {
        if (group === 'engines' || members === undefined) continue;
        for (const [name, value] of Object.entries(members as Record<string, unknown>)) {
            if (value !== undefined) changes.push([`${group}.${name}`, value]);
        }
    }
    for (const [engine, members] of Object.entries(patch.engines ?? {})) {
        for (const [name, value] of Object.entries(members)) {
            if (value !== undefined) changes.push([`engines.${engine}.${name}`, value]);
        }
    }
    return changes;
}

const engineOf = (key: string): string | undefined => (key.startsWith('engines.') ? key.split('.')[1] : undefined);

/** `http://tower:8081`, exactly: what a browser sends as `Origin`, and nothing a browser never would. */
function isOrigin(text: string): boolean {
    try {
        const url = new URL(text);
        return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === text;
    } catch {
        return false;
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
