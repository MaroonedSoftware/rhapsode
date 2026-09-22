import { existsSync, readFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { AppConfigBuilder, AppConfigSourceJson } from '@maroonedsoftware/appconfig';

import { StateEnginesSource, StateSettingsSource } from '../state/state.source.js';
import { STATE_FILE, StateStore } from '../state/state.store.js';
import type { RhapsodeConfig } from '../config.js';

/** One engine as configuration describes it, before the catalog has filled in the rest. */
export type ConfiguredEngine = NonNullable<RhapsodeConfig['engines']>[string];

/**
 * The file the core wrote before it had a database. Read once, imported, and renamed; never written.
 * protocol.md § 10, "The state database".
 */
export const MANAGED_FILE = 'rhapsode.engines.json';

/**
 * The engines this API installed, kept in the state database.
 *
 * Read underneath the operator's own file so that theirs wins wherever both name an engine. The core
 * never writes the operator's file: it may carry comments a rewrite would lose, it may sit on a
 * read-only path, and it is somebody's hand-kept record of the box.
 */
export class ManagedEngines {
    private constructor(
        /** Undefined for a server built without one, which can report but cannot install. */
        readonly store: StateStore | undefined,
        private readonly operatorOwned: ReadonlySet<string>,
    ) {}

    /** Nothing managed and nowhere to record it. What a server built in a test gets by default. */
    static none(operator: RhapsodeConfig = {}): ManagedEngines {
        return new ManagedEngines(undefined, new Set(Object.keys(operator.engines ?? {})));
    }

    static at(store: StateStore, operator: RhapsodeConfig): ManagedEngines {
        return new ManagedEngines(store, new Set(Object.keys(operator.engines ?? {})));
    }

    /** Installed through the API and not claimed by the operator, so the API may remove it. */
    isManaged(id: string): boolean {
        return this.entry(id) !== undefined && !this.operatorOwned.has(id);
    }

    /** Named in the operator's file, which makes it theirs whatever the database says. */
    isOperatorOwned(id: string): boolean {
        return this.operatorOwned.has(id);
    }

    /** What the database says of an engine, which is where a reinstall finds what was accepted. */
    entry(id: string): ConfiguredEngine | undefined {
        return this.store?.engine(id);
    }

    // Asynchronous although the store is not, so the installer's `await` still marks the point
    // after which the record is committed, which the reinstall's ordering depends on (§ 10).
    async record(id: string, entry: ConfiguredEngine): Promise<void> {
        this.writable().putEngine(id, entry);
    }

    async forget(id: string): Promise<void> {
        this.store?.deleteEngine(id);
    }

    private writable(): StateStore {
        if (this.store === undefined) throw new Error('this server has no state database, so it cannot record an install');
        return this.store;
    }
}

/** What `loadSettings` read, for the server to be built from. */
export interface LoadedSettings {
    /** Defaults excluded: the database over the operator's file over the engines the core installed. */
    settings: RhapsodeConfig;
    managed: ManagedEngines;
    store: StateStore;
    /** The operator's file on its own, which is how a setting is known to have come from it. */
    operator: RhapsodeConfig;
}

/**
 * The configuration a server starts with, and the database it keeps.
 *
 * Three layers, each over the one before: the engines the core installed, the operator's file, and
 * the settings in the database. protocol.md § 10. A missing config file is an empty one: a server
 * with no config starts with no engines, which has always been true.
 *
 * The caller owns the returned store and closes it; a server built with it closes it at shutdown.
 */
export async function loadSettings(configPath: string): Promise<LoadedSettings> {
    const store = StateStore.open(join(dirname(configPath), STATE_FILE));
    try {
        importManagedFile(store, join(dirname(configPath), MANAGED_FILE));

        const operatorSource = new AppConfigSourceJson(configPath);
        const operator = (await readSource(operatorSource, configPath)) as RhapsodeConfig;
        const engines = store.engines();
        const known = (id: string) => engines.has(id) || operator.engines?.[id] !== undefined;

        // Later sources win, by deep merge. The operator's file over the installed engines, so an
        // entry there overrides one field of an installed engine (its `env`, say) without restating
        // the rest; the database's settings over both. Arrays replace rather than concatenate.
        const merged = await new AppConfigBuilder()
            .addSource(new StateEnginesSource(store))
            .addSource(operatorSource)
            .addSource(new StateSettingsSource(store, known))
            .buildSnapshot<RhapsodeConfig>();

        return { settings: merged.toObject(), managed: ManagedEngines.at(store, operator), store, operator };
    } catch (error) {
        store.close();
        throw error;
    }
}

/**
 * Move `rhapsode.engines.json` into the database, once, and rename it out of the way.
 *
 * It replaces what the database holds rather than merging with it. The file exists only where an
 * older core wrote it, and a core that finds one after a database already exists has been downgraded
 * and upgraded again, so the file is the newer of the two. Renamed rather than deleted, so a downgrade
 * has it to go back to.
 */
function importManagedFile(store: StateStore, path: string): void {
    if (!existsSync(path)) return;
    let document: { engines?: Record<string, ConfiguredEngine> };
    try {
        document = JSON.parse(readFileSync(path, 'utf8')) as typeof document;
    } catch (error) {
        throw new Error(`could not read ${path}: ${(error as Error).message}`, { cause: error });
    }
    store.replaceEngines(document.engines ?? {});
    renameSync(path, `${path}.imported`);
}

async function readSource(source: AppConfigSourceJson, path: string): Promise<Record<string, unknown>> {
    try {
        return await source.load();
    } catch (error) {
        throw new Error(`could not read ${path}: ${(error as Error).message}`, { cause: error });
    }
}
