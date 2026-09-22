import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Settings, type SettingField } from '@rhapsode/contract';

import { DEFAULTS, SETTINGS, type RhapsodeConfig } from '../src/config.js';
import { RhapsodeJsonLogger } from '../src/logging/rhapsode.logger.js';
import { loadSettings } from '../src/registry/managed.engines.js';
import { buildServer } from '../src/server.js';

const silent = () => new RhapsodeJsonLogger('error', () => {});

let dir: string;
let running: Awaited<ReturnType<typeof buildServer>> | undefined;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rh-settings-'));
});

afterEach(async () => {
    await running?.app.close();
    running = undefined;
    rmSync(dir, { recursive: true, force: true });
});

/**
 * A server built as `apps/server` builds one: from the operator's file with the database over it.
 * `database` is written before the load, as an earlier `PATCH /settings` would have left it.
 */
async function start(file: RhapsodeConfig = {}, database: Record<string, unknown> = {}) {
    const configPath = join(dir, 'rhapsode.config.json');
    writeFileSync(configPath, JSON.stringify({ ...file, workers: { socketDir: join(dir, 's'), ...file.workers } }));
    const before = await loadSettings(configPath);
    for (const [key, value] of Object.entries(database)) before.store.setSetting(key, value);
    before.store.close();

    const { settings, managed, operator } = await loadSettings(configPath);
    running = await buildServer(settings, silent(), { managed, operator });
    await running.app.ready();
    return running.app;
}

async function read(app: Awaited<ReturnType<typeof start>>): Promise<Settings> {
    const response = await app.inject({ method: 'GET', url: '/settings' });
    expect(response.statusCode).toBe(200);
    // The only thing that ties the handler to the contract. § 9.
    return Settings.parse(response.json());
}

const field = (settings: Settings, key: string): SettingField | undefined => settings.fields.find(entry => entry.key === key);

describe('GET /settings', () => {
    it('answers the machine running rhapsode with every setting, each marked live or restart', async () => {
        const settings = await read(await start());

        expect(settings.fields.map(entry => entry.key)).toEqual(Object.keys(SETTINGS));
        expect(field(settings, 'residency.keepAliveSeconds')).toEqual({ key: 'residency.keepAliveSeconds', source: 'default', applies: 'live' });
        expect(field(settings, 'server.port')?.applies).toBe('restart');
        expect(settings.values.residency).toEqual({
            maxResidentModels: DEFAULTS.maxResidentModels,
            evictionWaitSeconds: DEFAULTS.evictionWaitSeconds,
            keepAliveSeconds: DEFAULTS.keepAliveSeconds,
        });
        expect(settings.values.server).toEqual({ port: DEFAULTS.port, host: DEFAULTS.host, shutdownGraceMs: DEFAULTS.shutdownGraceMs });
    });

    it('refuses a caller from another machine, although it only reads', async () => {
        // It names directories and trusted origins, which is a map for somebody deciding where to push. § 10.
        const app = await start();
        const response = await app.inject({ method: 'GET', url: '/settings', remoteAddress: '10.0.0.5' });

        expect(response.statusCode).toBe(403);
        expect(response.json().error).toMatchObject({ code: 'forbidden' });
    });

    it('says a token is set and never what it is', async () => {
        const app = await start({ management: { token: 's3cret-from-the-file' } });
        const response = await app.inject({ method: 'GET', url: '/settings', headers: { authorization: 'Bearer s3cret-from-the-file' } });

        expect(response.body).not.toContain('s3cret');
        expect(Settings.parse(response.json()).values.management.tokenSet).toBe(true);
    });

    it('names the layer each value came from, with the database over the file over the default', async () => {
        const settings = await read(
            await start({ server: { port: 9000 }, residency: { keepAliveSeconds: 60 } }, { 'residency.keepAliveSeconds': 900 }),
        );

        expect(field(settings, 'server.port')?.source).toBe('config');
        expect(field(settings, 'residency.keepAliveSeconds')?.source).toBe('database');
        expect(field(settings, 'residency.maxResidentModels')?.source).toBe('default');
        expect(settings.values.server.port).toBe(9000);
        expect(settings.values.residency.keepAliveSeconds).toBe(900);
    });

    it('counts a keep-alive in its old spelling as the file’s', async () => {
        const settings = await read(await start({ residency: { idleTerminateSeconds: 120 } }));

        expect(field(settings, 'residency.keepAliveSeconds')?.source).toBe('config');
        expect(settings.values.residency.keepAliveSeconds).toBe(120);
    });

    it('lists one keep-alive per engine in the registry, from the file or nowhere', async () => {
        const settings = await read(await start({ engines: { tone: { url: 'http://127.0.0.1:9', keepAliveSeconds: 45 } } }));

        expect(settings.values.engines).toEqual({ tone: { keepAliveSeconds: 45 } });
        expect(field(settings, 'engines.tone.keepAliveSeconds')).toEqual({ key: 'engines.tone.keepAliveSeconds', source: 'config', applies: 'live' });
    });

    it('shows a change waiting for a restart as saved, and the old value as the one in use', async () => {
        const app = await start({ server: { port: 9000 }, management: { token: 'old-token' } });
        // What a PATCH will do once the server is running: write the database and leave the process.
        const { store } = await loadSettings(join(dir, 'rhapsode.config.json'));
        store.setSetting('server.port', 9100);
        store.setSetting('management.token', 'new-token');
        store.close();

        const response = await app.inject({ method: 'GET', url: '/settings' });
        const settings = Settings.parse(response.json());

        expect(settings.values.server.port).toBe(9000);
        expect(field(settings, 'server.port')).toMatchObject({ source: 'database', saved: 9100 });
        // The token is compared and never shown, the waiting one included.
        expect(field(settings, 'management.token')).toMatchObject({ source: 'database', saved: true });
        expect(response.body).not.toContain('new-token');
        // Nothing else is waiting: a setting nobody changed is never reported as a change.
        expect(settings.fields.filter(entry => entry.saved !== undefined).map(entry => entry.key)).toEqual(['server.port', 'management.token']);
    });
});
