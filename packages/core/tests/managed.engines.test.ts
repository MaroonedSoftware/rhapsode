import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RhapsodeJsonLogger } from '../src/logging/rhapsode.logger.js';
import { entryFrom } from '../src/registry/engine.module.js';
import { EngineRegistry } from '../src/registry/engine.registry.js';
import { loadSettings, MANAGED_FILE, ManagedEngines, type LoadedSettings } from '../src/registry/managed.engines.js';
import { STATE_FILE, StateStore } from '../src/state/state.store.js';
import { WorkerRegistry } from '../src/workers/worker.registry.js';

let dir: string;
let configPath: string;
const opened: StateStore[] = [];

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rh-managed-'));
    configPath = join(dir, 'rhapsode.config.json');
});

afterEach(() => {
    for (const store of opened.splice(0)) store.close();
    rmSync(dir, { recursive: true, force: true });
});

const write = (name: string, value: unknown) => writeFileSync(join(dir, name), JSON.stringify(value));

async function load(): Promise<LoadedSettings> {
    const loaded = await loadSettings(configPath);
    opened.push(loaded.store);
    return loaded;
}

describe('loading settings', () => {
    it('starts empty when there is no config file, which is how a fresh box starts', async () => {
        const { settings, managed, store } = await load();

        expect(settings.engines ?? {}).toEqual({});
        expect(store.path).toBe(join(dir, STATE_FILE));
        expect(managed.isManaged('chatterbox')).toBe(false);
    });

    it('lets the operator’s file win, field by field, over what the server installed', async () => {
        // Deep merge rather than replace, so an operator can override one field of an installed
        // engine (its env, here) without restating the venv the installer chose.
        const first = await load();
        await first.managed.record('chatterbox', { venv: '/v/chatterbox', env: { A: '1' } });
        write('rhapsode.config.json', { engines: { chatterbox: { env: { B: '2' } } } });

        const { settings } = await load();

        expect(settings.engines?.chatterbox).toEqual({ venv: '/v/chatterbox', env: { A: '1', B: '2' } });
    });

    it('calls an engine the operator names theirs, even when the server installed it too', async () => {
        const first = await load();
        await first.managed.record('chatterbox', { venv: '/v/chatterbox' });
        await first.managed.record('tone', { venv: '/v/tone' });
        write('rhapsode.config.json', { engines: { chatterbox: { env: { B: '2' } } } });

        const { managed } = await load();

        expect(managed.isOperatorOwned('chatterbox')).toBe(true);
        expect(managed.isManaged('chatterbox')).toBe(false);
        expect(managed.isManaged('tone')).toBe(true);
    });

    it('lets a setting in the database win over the operator’s file, and the file over the default', async () => {
        write('rhapsode.config.json', { server: { port: 9000 }, residency: { keepAliveSeconds: 60 }, management: { origins: ['http://a'] } });
        const first = await load();
        first.store.setSetting('residency.keepAliveSeconds', 900);
        first.store.setSetting('management.origins', ['http://b']);

        const { settings } = await load();

        expect(settings.server?.port).toBe(9000);
        expect(settings.residency?.keepAliveSeconds).toBe(900);
        // An array in the database is the whole list, not an addition to the file's. § 10.
        expect(settings.management?.origins).toEqual(['http://b']);
    });

    it('leaves out a per-engine setting for an engine nothing else names, and keeps the row', async () => {
        // Merged, it would create an engine with nothing but a keep-alive, and the registry would
        // declare something with no way to run.
        const first = await load();
        first.store.setSetting('engines.gone.keepAliveSeconds', 30);

        const { settings, store } = await load();

        expect(settings.engines ?? {}).toEqual({});
        expect(store.setting('engines.gone.keepAliveSeconds')).toBe(30);
    });

    it('names the file it could not parse', async () => {
        writeFileSync(configPath, '{ not json');
        await expect(loadSettings(configPath)).rejects.toThrow(configPath);
    });
});

describe('importing the file the database replaced', () => {
    it('moves rhapsode.engines.json into the database once and renames it', async () => {
        write(MANAGED_FILE, { engines: { tone: { venv: '/v/tone', accepted: 'MIT' } } });

        const { settings, managed } = await load();

        expect(settings.engines?.tone).toEqual({ venv: '/v/tone', accepted: 'MIT' });
        expect(managed.isManaged('tone')).toBe(true);
        expect(existsSync(join(dir, MANAGED_FILE))).toBe(false);
        expect(existsSync(join(dir, `${MANAGED_FILE}.imported`))).toBe(true);

        // A second boot finds nothing to import and keeps what the first one did.
        expect((await load()).managed.entry('tone')).toEqual({ venv: '/v/tone', accepted: 'MIT' });
    });

    it('takes the file over the database, since only a downgraded core writes one after the database exists', async () => {
        const first = await load();
        await first.managed.record('kokoro', { venv: '/v/kokoro' });
        write(MANAGED_FILE, { engines: { tone: { venv: '/v/tone' } } });

        const { managed } = await load();

        expect(managed.entry('tone')).toEqual({ venv: '/v/tone' });
        expect(managed.entry('kokoro')).toBeUndefined();
    });

    it('names the file when it cannot parse it, and leaves it where it was', async () => {
        writeFileSync(join(dir, MANAGED_FILE), '{ not json');

        await expect(loadSettings(configPath)).rejects.toThrow(MANAGED_FILE);
        expect(existsSync(join(dir, MANAGED_FILE))).toBe(true);
    });
});

describe('recording an install', () => {
    it('writes the database, and a reload reads it back in id order', async () => {
        const { managed } = await load();
        await managed.record('tone', { venv: '/v/tone' });
        await managed.record('chatterbox', { venv: '/v/chatterbox' });

        const reloaded = await load();
        expect(Object.keys(reloaded.settings.engines ?? {})).toEqual(['chatterbox', 'tone']);
        expect(reloaded.settings.engines?.tone).toEqual({ venv: '/v/tone' });
        expect(reloaded.managed.isManaged('tone')).toBe(true);
    });

    it('never touches the operator’s file', async () => {
        writeFileSync(configPath, '{"engines":{}}');
        const { managed } = await load();
        await managed.record('tone', { venv: '/v/tone' });

        expect(readFileSync(configPath, 'utf8')).toBe('{"engines":{}}');
    });

    it('leaves nothing beside the config but the database', async () => {
        // The journal exists only during a write (§ 10), so a backup between writes is one file.
        writeFileSync(configPath, '{}');
        const { managed } = await load();
        await managed.record('tone', { venv: '/v/tone' });
        await managed.forget('tone');

        expect(readdirSync(dir).sort()).toEqual(['rhapsode.config.json', STATE_FILE]);
        expect(managed.entry('tone')).toBeUndefined();
    });

    it('forgets an engine’s own settings with it', async () => {
        const { managed, store } = await load();
        await managed.record('tone', { venv: '/v/tone' });
        store.setSetting('engines.tone.keepAliveSeconds', 30);
        store.setSetting('residency.keepAliveSeconds', 60);

        await managed.forget('tone');

        expect([...store.settings().keys()]).toEqual(['residency.keepAliveSeconds']);
    });

    it('refuses to record anything on a server built without a database', async () => {
        await expect(ManagedEngines.none().record('tone', { venv: '/v/tone' })).rejects.toThrow(/cannot record an install/);
    });
});

describe('an engine added and removed at runtime', () => {
    it('passes the same licence gate as one read at boot', () => {
        expect(() => entryFrom('mystery', { venv: '/v/mystery' })).toThrow(/nothing knows its licence/);
        expect(entryFrom('tone', { venv: '/v/tone' }).license.code).toBe('MIT');
    });

    it('can be removed from the registry', () => {
        const engines = new EngineRegistry();
        engines.declare(entryFrom('tone', { venv: '/v/tone' }));
        engines.remove('tone');

        expect(engines.has('tone')).toBe(false);
        expect(engines.summaries()).toEqual([]);
    });

    it('gets a fresh worker handle once the old one is forgotten', async () => {
        // A handle captures the entry it was built from. Without forget, a reinstalled engine
        // would go on spawning the old command.
        const engines = new EngineRegistry();
        engines.declare(entryFrom('tone', { url: 'http://127.0.0.1:9' }));
        const workers = new WorkerRegistry(engines, new RhapsodeJsonLogger('error', () => {}), {
            socketDir: dir,
            startupTimeoutSeconds: 1,
            drainGraceMs: 100,
            maxRestarts: 1,
            restartDecaySeconds: 1,
        });

        const before = workers.handle('tone');
        await workers.forget('tone');

        expect(workers.handle('tone')).not.toBe(before);
    });
});
