import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { DateTime } from 'luxon';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CORE_VERSION } from '../src/core.version.js';
import { RhapsodeJsonLogger } from '../src/logging/rhapsode.logger.js';
import { loadSettings } from '../src/registry/managed.engines.js';
import { BACKUP_DIR, backupOnUpgrade } from '../src/state/state.backup.js';
import { STATE_FILE, StateStore } from '../src/state/state.store.js';

let dir: string;
let configPath: string;
let lines: string[];
const logger = () => new RhapsodeJsonLogger('info', line => lines.push(line));

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rh-backup-'));
    configPath = join(dir, 'rhapsode.config.json');
    lines = [];
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A database as a core at `version` left it, with one setting in it to find in the copy. */
function leftBy(version: string | undefined): void {
    StateStore.open(join(dir, STATE_FILE)).close();
    const db = new DatabaseSync(join(dir, STATE_FILE));
    if (version === undefined) db.prepare("DELETE FROM meta WHERE key = 'coreVersion'").run();
    else db.prepare("UPDATE meta SET value = ? WHERE key = 'coreVersion'").run(version);
    db.prepare("INSERT OR REPLACE INTO settings (key, value, updatedAt) VALUES ('server.port', '9000', 'then')").run();
    db.close();
}

const copies = () => (existsSync(join(dir, BACKUP_DIR)) ? readdirSync(join(dir, BACKUP_DIR)).sort() : []);

describe('copying the config directory before an upgrade', () => {
    it('copies the database, the config and the voices when another core last opened them', () => {
        leftBy('0.0.1');
        writeFileSync(configPath, '{"update":{"check":false}}');
        mkdirSync(join(dir, 'voices', 'chatterbox'), { recursive: true });
        writeFileSync(join(dir, 'voices', 'chatterbox', 'ana.wav'), 'RIFF');

        const target = backupOnUpgrade(configPath, CORE_VERSION, logger(), DateTime.utc(2026, 10, 10, 9, 30));

        expect(target).toBe(join(dir, BACKUP_DIR, `20261010T093000Z-before-${CORE_VERSION}`));
        expect(readFileSync(join(target!, 'rhapsode.config.json'), 'utf8')).toBe('{"update":{"check":false}}');
        expect(readFileSync(join(target!, 'voices', 'chatterbox', 'ana.wav'), 'utf8')).toBe('RIFF');
        const copy = new DatabaseSync(join(target!, STATE_FILE), { readOnly: true });
        expect(copy.prepare("SELECT value FROM settings WHERE key = 'server.port'").get()).toEqual({ value: '9000' });
        copy.close();
        expect(lines.join('\n')).toContain(target!);
    });

    it('copies a database no core recorded a version in, which one older than the rule left', () => {
        leftBy(undefined);

        expect(backupOnUpgrade(configPath, CORE_VERSION, logger())).toBeDefined();
    });

    it('copies nothing on a fresh box, or when this core opened the database last', () => {
        expect(backupOnUpgrade(configPath, CORE_VERSION, logger())).toBeUndefined();

        leftBy(CORE_VERSION);
        expect(backupOnUpgrade(configPath, CORE_VERSION, logger())).toBeUndefined();
        expect(copies()).toEqual([]);
    });

    it('keeps the three newest copies', () => {
        for (let day = 1; day <= 5; day += 1) {
            leftBy(`0.0.${day}`);
            backupOnUpgrade(configPath, CORE_VERSION, logger(), DateTime.utc(2026, 10, day));
        }

        expect(copies()).toEqual(
            ['20261003T000000Z', '20261004T000000Z', '20261005T000000Z'].map(time => `${time}-before-${CORE_VERSION}`),
        );
    });

    it('starts without a copy when it cannot make one, and says so', () => {
        leftBy('0.0.1');
        // A file where the directory of copies goes.
        writeFileSync(join(dir, BACKUP_DIR), '');

        expect(backupOnUpgrade(configPath, CORE_VERSION, logger())).toBeUndefined();
        expect(lines.join('\n')).toContain('could not copy the config directory');
    });

    it('happens when the settings are loaded, once per version', async () => {
        leftBy('0.0.1');

        (await loadSettings(configPath, logger())).store.close();
        (await loadSettings(configPath, logger())).store.close();

        expect(copies()).toHaveLength(1);
    });
});
