import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { Logger } from '@maroonedsoftware/logger';
import { DateTime } from 'luxon';

import { STATE_FILE } from './state.store.js';

/** Beside the config file, with one directory per copy. protocol.md § 10, "The state database". */
export const BACKUP_DIR = 'rhapsode.backups';

/** Enough to step back through two upgrades and still have one to spare, at about 6 MB each. */
const KEEP = 3;

/** What sits beside the config and is copied with it, when it is there. */
const ALONGSIDE = ['rhapsode.engines.json', 'voices'];

/**
 * Copy the config directory's state when the core opening it is not the one that last did. § 10.
 *
 * Before the database is opened for writing, so before any import or migration a new core runs,
 * which is the point: the copy is of what the old core left. A database with no version recorded
 * was last opened by a core older than this rule, and is copied as well. A fresh box has nothing
 * to copy. Answers where the copy went, or undefined where none was needed or it failed.
 *
 * Never throws. Operators were told to `docker cp` the config out before every upgrade, and a
 * start refused because a copy failed would be a worse outcome than the one it guards against.
 */
export function backupOnUpgrade(configPath: string, version: string, logger: Logger, now: DateTime = DateTime.utc()): string | undefined {
    const dir = dirname(configPath);
    const database = join(dir, STATE_FILE);
    if (!existsSync(database)) return undefined;

    try {
        const db = new DatabaseSync(database, { readOnly: true });
        try {
            if (recordedVersion(db) === version) return undefined;

            const root = join(dir, BACKUP_DIR);
            const target = join(root, `${now.toFormat("yyyyLLdd'T'HHmmss'Z'")}-before-${version}`);
            mkdirSync(target, { recursive: true });
            // Owner only, as the database and the config are: both can hold the management token.
            chmodSync(root, 0o700);
            // Consistent even while another process holds the database, which a file copy is not.
            db.prepare('VACUUM INTO ?').run(join(target, STATE_FILE));
            for (const name of [basename(configPath), ...ALONGSIDE]) {
                const source = join(dir, name);
                if (existsSync(source)) cpSync(source, join(target, name), { recursive: true });
            }
            prune(root);
            logger.info(`copied the config directory to ${target} before this core (${version}) opens it`);
            return target;
        } finally {
            db.close();
        }
    } catch (error) {
        logger.warn('could not copy the config directory before an upgrade, so starting without a copy', {
            error: error instanceof Error ? error.message : String(error),
        });
        return undefined;
    }
}

/** The version `StateStore.open` recorded, or undefined for a database no core recorded one in. */
function recordedVersion(db: DatabaseSync): string | undefined {
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'").get();
    if (table === undefined) return undefined;
    const row = db.prepare('SELECT value FROM meta WHERE key = ?').get('coreVersion') as { value: string } | undefined;
    return row?.value;
}

/** The newest `KEEP` copies, by name, which begins with when each was made. */
function prune(root: string): void {
    const copies = readdirSync(root, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .sort();
    for (const name of copies.slice(0, -KEEP)) rmSync(join(root, name), { recursive: true, force: true });
}
