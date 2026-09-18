import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RhapsodeJsonLogger } from '../src/logging/rhapsode.logger.js';
import { entryFrom } from '../src/registry/engine.module.js';
import { EngineRegistry } from '../src/registry/engine.registry.js';
import { loadSettings, MANAGED_FILE, ManagedEngines } from '../src/registry/managed.engines.js';
import { WorkerRegistry } from '../src/workers/worker.registry.js';

let dir: string;
let configPath: string;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rh-managed-'));
    configPath = join(dir, 'rhapsode.config.json');
});

afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

const write = (name: string, value: unknown) => writeFileSync(join(dir, name), JSON.stringify(value));

describe('loading settings', () => {
    it('treats both files as empty when neither exists, which is how a fresh box starts', async () => {
        const { settings, managed } = await loadSettings(configPath);

        expect(settings.engines ?? {}).toEqual({});
        expect(managed.path).toBe(join(dir, MANAGED_FILE));
        expect(managed.isManaged('chatterbox')).toBe(false);
    });

    it('lets the operator’s file win, field by field, over what the server installed', async () => {
        // Deep merge rather than replace, so an operator can override one field of an installed
        // engine (its env, here) without restating the venv the installer chose.
        write(MANAGED_FILE, { engines: { chatterbox: { venv: '/v/chatterbox', env: { A: '1' } } } });
        write('rhapsode.config.json', { engines: { chatterbox: { env: { B: '2' } } } });

        const { settings } = await loadSettings(configPath);

        expect(settings.engines?.chatterbox).toEqual({ venv: '/v/chatterbox', env: { A: '1', B: '2' } });
    });

    it('calls an engine the operator names theirs, even when the server installed it too', async () => {
        write(MANAGED_FILE, { engines: { chatterbox: { venv: '/v/chatterbox' }, tone: { venv: '/v/tone' } } });
        write('rhapsode.config.json', { engines: { chatterbox: { env: { B: '2' } } } });

        const { managed } = await loadSettings(configPath);

        expect(managed.isOperatorOwned('chatterbox')).toBe(true);
        expect(managed.isManaged('chatterbox')).toBe(false);
        expect(managed.isManaged('tone')).toBe(true);
    });

    it('names the file it could not parse', async () => {
        writeFileSync(configPath, '{ not json');
        await expect(loadSettings(configPath)).rejects.toThrow(configPath);
    });
});

describe('recording an install', () => {
    it('writes the managed file, sorted, and a reload reads it back', async () => {
        const { managed } = await loadSettings(configPath);
        await managed.record('tone', { venv: '/v/tone' });
        await managed.record('chatterbox', { venv: '/v/chatterbox' });

        const written = JSON.parse(readFileSync(join(dir, MANAGED_FILE), 'utf8'));
        expect(Object.keys(written.engines)).toEqual(['chatterbox', 'tone']);

        const reloaded = await loadSettings(configPath);
        expect(reloaded.settings.engines?.tone).toEqual({ venv: '/v/tone' });
        expect(reloaded.managed.isManaged('tone')).toBe(true);
    });

    it('never touches the operator’s file', async () => {
        writeFileSync(configPath, '{"engines":{}}');
        const { managed } = await loadSettings(configPath);
        await managed.record('tone', { venv: '/v/tone' });

        expect(readFileSync(configPath, 'utf8')).toBe('{"engines":{}}');
    });

    it('leaves no temporary file behind', async () => {
        const { managed } = await loadSettings(configPath);
        await managed.record('tone', { venv: '/v/tone' });
        await managed.forget('tone');

        expect(readdirSync(dir)).toEqual([MANAGED_FILE]);
        expect(JSON.parse(readFileSync(join(dir, MANAGED_FILE), 'utf8'))).toEqual({ engines: {} });
    });

    it('refuses to record anything on a server built without a managed file', async () => {
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
