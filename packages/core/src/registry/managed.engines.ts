import { randomBytes } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import { AppConfigBuilder, AppConfigSourceJson } from '@maroonedsoftware/appconfig';

import type { RhapsodeConfig } from '../config.js';

/** One engine as configuration describes it, before the catalog has filled in the rest. */
export type ConfiguredEngine = NonNullable<RhapsodeConfig['engines']>[string];

/** The file the core writes, beside the operator's. protocol.md § 10. */
export const MANAGED_FILE = 'rhapsode.engines.json';

/**
 * The engines this API installed, and the file it keeps them in.
 *
 * The file is a fragment of configuration, `{ "engines": { ... } }`, read underneath the operator's
 * own so that theirs wins wherever both name an engine. The core never writes the operator's file:
 * it may carry comments a rewrite would lose, it may sit on a read-only path, and it is somebody's
 * hand-kept record of the box. One writer per file is what keeps both honest.
 */
export class ManagedEngines {
    private constructor(
        /** Undefined for a server built without one, which can report but cannot install. */
        readonly path: string | undefined,
        private readonly entries: Map<string, ConfiguredEngine>,
        private readonly operatorOwned: ReadonlySet<string>,
    ) {}

    /** Nothing managed and nowhere to record it. What a server built in a test gets by default. */
    static none(operator: RhapsodeConfig = {}): ManagedEngines {
        return new ManagedEngines(undefined, new Map(), new Set(Object.keys(operator.engines ?? {})));
    }

    static at(path: string, managed: RhapsodeConfig, operator: RhapsodeConfig): ManagedEngines {
        return new ManagedEngines(path, new Map(Object.entries(managed.engines ?? {})), new Set(Object.keys(operator.engines ?? {})));
    }

    /** Installed through the API and not claimed by the operator, so the API may remove it. */
    isManaged(id: string): boolean {
        return this.entries.has(id) && !this.operatorOwned.has(id);
    }

    /** Named in the operator's file, which makes it theirs whatever the managed file says. */
    isOperatorOwned(id: string): boolean {
        return this.operatorOwned.has(id);
    }

    /** What the managed file says of an engine, which is where a reinstall finds what was accepted. */
    entry(id: string): ConfiguredEngine | undefined {
        return this.entries.get(id);
    }

    async record(id: string, entry: ConfiguredEngine): Promise<void> {
        this.entries.set(id, entry);
        await this.persist();
    }

    async forget(id: string): Promise<void> {
        if (!this.entries.delete(id)) return;
        await this.persist();
    }

    private async persist(): Promise<void> {
        if (this.path === undefined) throw new Error('this server has no managed engines file, so it cannot record an install');
        const document = { engines: Object.fromEntries([...this.entries].sort(([a], [b]) => a.localeCompare(b))) };
        await writeAtomically(this.path, `${JSON.stringify(document, undefined, 4)}\n`);
    }
}

/**
 * The operator's config with the managed file underneath it, and the managed file on its own.
 *
 * A missing file of either kind is an empty one: a server with no config starts with no engines,
 * which has always been true, and a box that never installed anything has no managed file.
 */
export async function loadSettings(configPath: string): Promise<{ settings: RhapsodeConfig; managed: ManagedEngines }> {
    const managedPath = join(dirname(configPath), MANAGED_FILE);
    const operatorSource = new AppConfigSourceJson(configPath);
    const managedSource = new AppConfigSourceJson(managedPath);

    const [operator, managed] = await Promise.all([readSource(operatorSource, configPath), readSource(managedSource, managedPath)]);

    // Later sources win, by deep merge. Operator last, so an entry there overrides the same field
    // of an installed engine (its `env`, say) without having to restate the rest of it.
    const merged = await new AppConfigBuilder().addSource(managedSource).addSource(operatorSource).buildSnapshot<RhapsodeConfig>();

    return {
        settings: merged.toObject(),
        managed: ManagedEngines.at(managedPath, managed as RhapsodeConfig, operator as RhapsodeConfig),
    };
}

async function readSource(source: AppConfigSourceJson, path: string): Promise<Record<string, unknown>> {
    try {
        return await source.load();
    } catch (error) {
        throw new Error(`could not read ${path}: ${(error as Error).message}`, { cause: error });
    }
}

/**
 * Write to a temporary file beside the target, then rename over it.
 *
 * A rename within one directory is atomic, so a reader sees the old file or the new one and never
 * half of either. A server killed mid-write would otherwise leave a managed file that fails to parse,
 * and the next boot would refuse to start over an install that had in fact succeeded.
 */
export async function writeAtomically(path: string, contents: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const temporary = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString('hex')}.tmp`);
    try {
        await writeFile(temporary, contents, 'utf8');
        await rename(temporary, path);
    } catch (error) {
        await rm(temporary, { force: true });
        throw error;
    }
}
