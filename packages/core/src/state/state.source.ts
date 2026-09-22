import { nestKeys, type AppConfigSource } from '@maroonedsoftware/appconfig';

import type { StateStore } from './state.store.js';

/**
 * The engines the core installed, as a layer of configuration: `{ engines: { ... } }`, exactly the
 * shape `rhapsode.engines.json` had, so the operator's file still merges over it field by field.
 */
export class StateEnginesSource implements AppConfigSource {
    constructor(private readonly store: StateStore) {}

    async load(): Promise<Record<string, unknown>> {
        return { engines: Object.fromEntries(this.store.engines()) };
    }

    async get(key: string): Promise<unknown> {
        const [root, id, ...rest] = key.split('.');
        if (root !== 'engines' || id === undefined || rest.length > 0) return undefined;
        return this.store.engine(id);
    }

    watch(): () => void {
        return () => {};
    }
}

/**
 * The settings written through `PATCH /settings`, as the top layer of configuration. protocol.md § 10.
 *
 * `known` says which engines exist. A per-engine setting for an engine that is in neither the
 * operator's file nor the database is left out rather than merged, because merged it would create an
 * `engines.<id>` entry with nothing in it but a keep-alive, and the registry would declare an engine
 * with no way to run. It happens when the operator removes an engine from their file; the row is kept
 * so that putting the engine back brings its setting back too.
 */
export class StateSettingsSource implements AppConfigSource {
    constructor(
        private readonly store: StateStore,
        private readonly known: (engine: string) => boolean,
    ) {}

    async load(): Promise<Record<string, unknown>> {
        const kept = [...this.store.settings()].filter(([key]) => this.applies(key));
        return nestKeys(Object.fromEntries(kept), '.');
    }

    async get(key: string): Promise<unknown> {
        return this.applies(key) ? this.store.setting(key) : undefined;
    }

    watch(): () => void {
        return () => {};
    }

    private applies(key: string): boolean {
        const [root, id] = key.split('.');
        return root !== 'engines' || (id !== undefined && this.known(id));
    }
}
