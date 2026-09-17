import { Injectable } from 'injectkit';

import type { EngineSummary, License, ResidencySummary } from '@rhapsode/contract';

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

    declare(entry: EngineEntry): void {
        this.entries.set(entry.id, entry);
        if (!this.states.has(entry.id)) {
            this.states.set(entry.id, { process: 'down', model: 'unloaded', restarts: 0 });
        }
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
            return {
                id: entry.id,
                displayName: entry.displayName,
                license: entry.license,
                process: state.process,
                model: state.model,
                restarts: state.restarts,
                ...(state.variant === undefined ? {} : { variant: state.variant }),
                ...(state.lastError === undefined ? {} : { lastError: state.lastError }),
            };
        });
    }

    residency(): ResidencySummary {
        const resident = [...this.states.values()].filter(state => state.model === 'loaded' || state.model === 'loading');
        return { resident: resident.length, max: this.maxResidentModels, waiting: 0 };
    }

    /** Set by the residency module, which owns the policy. The registry only reports it. */
    maxResidentModels = 1;
}

export interface EngineState {
    process: EngineSummary['process'];
    model: EngineSummary['model'];
    variant?: string;
    lastError?: string;
    restarts: number;
}
