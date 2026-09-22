import { Injectable } from 'injectkit';

import type { EngineSummary, License } from '@rhapsode/contract';

import { CORE_VERSION } from '../core.version.js';
import { installedWorkerVersion } from './worker.version.js';

/** What an engine is, before anything has tried to run it. */
export interface EngineEntry {
    id: string;
    displayName: string;
    license: License;
    /** The module a local worker is started as, from the catalog. */
    module?: string;
    /** Set for a local worker, absent for a remote one. */
    venv?: string;
    command?: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    /** Set for a remote worker, absent for a local one. This one field is the whole difference. */
    url?: string;
    autostart?: boolean;
    defaultVariant?: string;
    /**
     * This engine's own keep-alive, overriding `residency.keepAliveSeconds`. § 3.
     *
     * Per engine because the cost of a cold start is per engine: a model that takes forty seconds
     * to load earns a longer deadline than one that takes two, and a request can only say what it
     * wants for itself.
     */
    keepAliveSeconds?: number;
}

/**
 * Every engine this server knows about, whether or not it is running.
 *
 * The catalog half is "what exists" and ships with the core; the config half is "what this box has".
 * Keeping the licence in the catalog is what makes § 4's promise true: the weights licence is
 * visible **before** install rather than after, which is the only time it can change a decision.
 */
@Injectable()
export class EngineRegistry {
    private readonly entries = new Map<string, EngineEntry>();
    private readonly states = new Map<string, EngineState>();
    /**
     * `rhapsode-worker` in each engine's venv, read here rather than in `summaries()`.
     *
     * A venv only changes when an install or an uninstall changes it, and both go through this
     * class, so this is read once per engine instead of once per request. `/health` is what a
     * container's healthcheck polls; putting a directory listing per engine on that path would
     * have been a syscall every few seconds to answer a question whose answer cannot have changed.
     */
    private readonly workerVersions = new Map<string, string | undefined>();

    declare(entry: EngineEntry): void {
        this.entries.set(entry.id, entry);
        this.workerVersions.set(entry.id, installedWorkerVersion(entry.venv));
        if (!this.states.has(entry.id)) {
            this.states.set(entry.id, { process: 'down', model: 'unloaded', restarts: 0 });
        }
    }

    /** An engine uninstalled at runtime. Its worker is the worker registry's to stop, first. */
    remove(id: string): void {
        this.entries.delete(id);
        this.states.delete(id);
        this.workerVersions.delete(id);
    }

    /** What `rhapsode-worker` this engine's venv holds, for the doctor and for § 9's `workerVersion`. */
    workerVersion(id: string): string | undefined {
        return this.workerVersions.get(id);
    }

    /**
     * Whether an upgrade left this engine's pin behind, so that no client compares versions. § 9.
     *
     * "Differs" rather than "older": a core rolled back breaks the pin the same way, and the remedy
     * is the same reinstall. Undefined where `workerVersion` is, rather than guessed.
     */
    outdated(id: string): boolean | undefined {
        const workerVersion = this.workerVersion(id);
        return workerVersion === undefined ? undefined : workerVersion !== CORE_VERSION;
    }

    has(id: string): boolean {
        return this.entries.has(id);
    }

    ids(): string[] {
        return [...this.entries.keys()];
    }

    entry(id: string): EngineEntry | undefined {
        return this.entries.get(id);
    }

    state(id: string): EngineState {
        return this.states.get(id) ?? { process: 'down', model: 'unloaded', restarts: 0 };
    }

    observe(id: string, state: Partial<EngineState>): void {
        this.states.set(id, { ...this.state(id), ...state });
    }

    summaries(): EngineSummary[] {
        return [...this.entries.values()].map(entry => {
            const state = this.state(entry.id);
            const workerVersion = this.workerVersion(entry.id);
            const outdated = this.outdated(entry.id);
            return {
                id: entry.id,
                displayName: entry.displayName,
                license: entry.license,
                process: state.process,
                model: state.model,
                restarts: state.restarts,
                ...(state.variant === undefined ? {} : { variant: state.variant }),
                ...(state.lastError === undefined ? {} : { lastError: state.lastError }),
                ...(workerVersion === undefined ? {} : { workerVersion }),
                ...(outdated === undefined ? {} : { outdated }),
            };
        });
    }
}

export interface EngineState {
    process: EngineSummary['process'];
    model: EngineSummary['model'];
    variant?: string;
    lastError?: string;
    restarts: number;
}
