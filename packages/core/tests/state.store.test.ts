import { chmodSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { STATE_FILE, StateStore } from '../src/state/state.store.js';

let dir: string;
let path: string;
const opened: StateStore[] = [];

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rh-state-'));
    path = join(dir, STATE_FILE);
});

afterEach(() => {
    for (const store of opened.splice(0)) store.close();
    chmodSync(dir, 0o700);
    rmSync(dir, { recursive: true, force: true });
});

function open(at = path): StateStore {
    const store = StateStore.open(at);
    opened.push(store);
    return store;
}

describe('opening', () => {
    it('creates the database, and its directory, readable by its owner only', () => {
        open(join(dir, 'config', STATE_FILE));

        expect(statSync(join(dir, 'config', STATE_FILE)).mode & 0o777).toBe(0o600);
    });

    it('keeps no write-ahead log beside the file, so a copy of the file between writes is all of it', () => {
        const store = open();
        store.setSetting('server.port', 9000);
        store.close();

        const raw = new DatabaseSync(path);
        expect(raw.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'delete' });
        raw.close();
    });

    it('refuses at open, naming the path, when the database cannot be written', () => {
        // A container restarted as another user than the one that made the file. Found here rather
        // than by the first install. § 10.
        open().close();
        chmodSync(path, 0o400);

        expect(() => open()).toThrow(path);
    });

    it('refuses a database written by a newer core rather than half-reading it', () => {
        open().close();
        const raw = new DatabaseSync(path);
        raw.prepare("UPDATE meta SET value = '99' WHERE key = 'schema'").run();
        raw.close();

        expect(() => open()).toThrow(/schema 99/);
    });
});

describe('settings', () => {
    it('reads back what it was given, JSON and all', () => {
        const store = open();
        store.setSetting('management.origins', ['http://tower:8081']);
        store.setSetting('update.check', false);

        expect(store.setting('management.origins')).toEqual(['http://tower:8081']);
        expect(store.setting('update.check')).toBe(false);
        expect([...store.settings().keys()]).toEqual(['management.origins', 'update.check']);
    });

    it('clears a setting given undefined, so the layer below shows through', () => {
        const store = open();
        store.setSetting('server.port', 9000);
        store.setSetting('server.port', undefined);

        expect(store.setting('server.port')).toBeUndefined();
        expect(store.settings().size).toBe(0);
    });
});

describe('transactions', () => {
    it('keeps none of a transaction that throws', () => {
        const store = open();

        expect(() =>
            store.transaction(() => {
                store.setSetting('server.port', 9000);
                throw new Error('refused');
            }),
        ).toThrow('refused');
        expect(store.setting('server.port')).toBeUndefined();
    });

    it('joins a nested transaction to the outer one rather than committing it early', () => {
        const store = open();

        expect(() =>
            store.transaction(() => {
                store.putEngine('tone', { venv: '/v/tone' });
                store.deleteEngine('kokoro'); // a transaction of its own when called alone
                throw new Error('refused');
            }),
        ).toThrow('refused');
        expect(store.engine('tone')).toBeUndefined();
    });
});

describe('engines', () => {
    it('deletes only the settings of the engine it forgets, whatever the id contains', () => {
        // LIKE treats `_` as any one character, so an unescaped `a_b` would match `axb` too.
        const store = open();
        store.setSetting('engines.a_b.keepAliveSeconds', 1);
        store.setSetting('engines.axb.keepAliveSeconds', 2);

        store.deleteEngine('a_b');

        expect([...store.settings().keys()]).toEqual(['engines.axb.keepAliveSeconds']);
    });
});
