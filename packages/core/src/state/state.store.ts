import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { DateTime } from 'luxon';

import type { ConfiguredEngine } from '../registry/managed.engines.js';

/** The database the core writes, beside the operator's config file. protocol.md § 10. */
export const STATE_FILE = 'rhapsode.db';

/** Bumped by a migration. A database newer than this core is refused rather than half-read. */
const SCHEMA = 1;

/**
 * What the core has been told since boot: the engines it installed and the settings written
 * through `PATCH /settings`. protocol.md § 10, "The state database".
 *
 * It replaces `rhapsode.engines.json`, a file rewritten whole on every install, because settings
 * made a second writer, and two writers rewriting one file need a lock between them to avoid losing
 * each other's write. Here each is a transaction. It is synchronous because `node:sqlite` is, and
 * every statement is a few rows: nothing here waits long enough to be worth an `await`.
 */
export class StateStore {
    private depth = 0;
    // Not `DatabaseSync.isOpen`, which is newer than the 22.13 this core supports.
    private closed = false;

    private constructor(
        readonly path: string,
        private readonly db: DatabaseSync,
    ) {}

    /**
     * Open or create the database, and write to it once.
     *
     * The write is the point. SQLite opens a file it cannot write as read-only without saying so, and
     * the first sign would be an install failing hours later with "attempt to write a readonly
     * database". The usual cause is a container restarted as a different user than the one that
     * created the file, and it is cheaper to refuse the start, naming the path, than to find out then.
     */
    static open(path: string): StateStore {
        mkdirSync(dirname(path), { recursive: true });
        const created = !existsSync(path);
        const db = new DatabaseSync(path);
        // Owner only, as the Docker image writes the config: this holds the management token once
        // anybody sets one through the API.
        if (created) chmodSync(path, 0o600);

        // DELETE rather than WAL, so that between writes everything committed is in this one file. A
        // backup of the config directory taken while the core runs, which docs/operating.md tells
        // people to make, would otherwise copy a database without its last writes, which are in a
        // -wal file beside it.
        db.exec('PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;');

        const store = new StateStore(path, db);
        try {
            store.migrate();
            db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run('openedAt', DateTime.utc().toISO());
        } catch (error) {
            db.close();
            throw new Error(`could not open ${path}: ${(error as Error).message}`, { cause: error });
        }
        return store;
    }

    private migrate(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS engines (id TEXT PRIMARY KEY, entry TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updatedAt TEXT NOT NULL);
        `);
        const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get('schema') as { value: string } | undefined;
        const found = row === undefined ? undefined : Number(row.value);
        if (found !== undefined && found > SCHEMA) {
            throw new Error(`the database is at schema ${found} and this core reads up to ${SCHEMA}; it was written by a newer rhapsode`);
        }
        if (found === undefined) this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('schema', String(SCHEMA));
    }

    /**
     * Run `work` as one transaction, committed if it returns and rolled back if it throws.
     *
     * Nested calls join the outer transaction rather than opening their own, so a helper that writes
     * in a transaction can be called from inside a larger one without committing half of it.
     */
    transaction<T>(work: () => T): T {
        if (this.depth > 0) return this.nested(work);
        this.db.exec('BEGIN IMMEDIATE');
        try {
            const result = this.nested(work);
            this.db.exec('COMMIT');
            return result;
        } catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }

    private nested<T>(work: () => T): T {
        this.depth++;
        try {
            return work();
        } finally {
            this.depth--;
        }
    }

    /** Every engine this API installed, by id, in id order. */
    engines(): Map<string, ConfiguredEngine> {
        const rows = this.db.prepare('SELECT id, entry FROM engines ORDER BY id').all() as { id: string; entry: string }[];
        return new Map(rows.map(row => [row.id, JSON.parse(row.entry) as ConfiguredEngine]));
    }

    engine(id: string): ConfiguredEngine | undefined {
        const row = this.db.prepare('SELECT entry FROM engines WHERE id = ?').get(id) as { entry: string } | undefined;
        return row === undefined ? undefined : (JSON.parse(row.entry) as ConfiguredEngine);
    }

    putEngine(id: string, entry: ConfiguredEngine): void {
        this.db.prepare('INSERT OR REPLACE INTO engines (id, entry) VALUES (?, ?)').run(id, JSON.stringify(entry));
    }

    /** Forget an engine, and the settings that were only about it. protocol.md § 10, "Uninstalling". */
    deleteEngine(id: string): void {
        this.transaction(() => {
            this.db.prepare('DELETE FROM engines WHERE id = ?').run(id);
            this.db.prepare('DELETE FROM settings WHERE key LIKE ? ESCAPE ?').run(`engines.${escapeLike(id)}.%`, '\\');
        });
    }

    /** Replace every engine at once, which is what importing the file this database replaced means. */
    replaceEngines(entries: Record<string, ConfiguredEngine>): void {
        this.transaction(() => {
            this.db.exec('DELETE FROM engines');
            for (const [id, entry] of Object.entries(entries)) this.putEngine(id, entry);
        });
    }

    /** Every setting the database holds, by dotted key. Absent is "not set", never a stored null. */
    settings(): Map<string, unknown> {
        const rows = this.db.prepare('SELECT key, value FROM settings ORDER BY key').all() as { key: string; value: string }[];
        return new Map(rows.map(row => [row.key, JSON.parse(row.value) as unknown]));
    }

    setting(key: string): unknown {
        const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
        return row === undefined ? undefined : (JSON.parse(row.value) as unknown);
    }

    /** `undefined` clears the setting, so the layer below it shows through again. */
    setSetting(key: string, value: unknown): void {
        if (value === undefined) {
            this.db.prepare('DELETE FROM settings WHERE key = ?').run(key);
            return;
        }
        this.db
            .prepare('INSERT OR REPLACE INTO settings (key, value, updatedAt) VALUES (?, ?, ?)')
            .run(key, JSON.stringify(value), DateTime.utc().toISO());
    }

    /** Idempotent, since the server's shutdown and a test's teardown may both close it. */
    close(): void {
        if (this.closed) return;
        this.closed = true;
        this.db.close();
    }
}

/** An engine id is a catalog key, but a `%` or `_` in one must not widen what an uninstall deletes. */
const escapeLike = (text: string): string => text.replace(/[\\%_]/g, match => `\\${match}`);
