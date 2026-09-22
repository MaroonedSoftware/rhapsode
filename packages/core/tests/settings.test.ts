import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    vi.unstubAllEnvs();
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

type App = Awaited<ReturnType<typeof start>>;

const patch = (app: App, body: unknown, headers: Record<string, string> = {}, remoteAddress?: string) =>
    app.inject({
        method: 'PATCH',
        url: '/settings',
        payload: body as object,
        headers: { 'content-type': 'application/json', ...headers },
        ...(remoteAddress === undefined ? {} : { remoteAddress }),
    });

describe('PATCH /settings', () => {
    it('applies a residency setting at once, where /residency can see it', async () => {
        const app = await start();

        const response = await patch(app, { residency: { maxResidentModels: 2, keepAliveSeconds: 900 } });

        expect(response.statusCode).toBe(200);
        const settings = Settings.parse(response.json());
        expect(settings.values.residency).toMatchObject({ maxResidentModels: 2, keepAliveSeconds: 900 });
        expect(field(settings, 'residency.keepAliveSeconds')).toEqual({ key: 'residency.keepAliveSeconds', source: 'database', applies: 'live' });
        expect((await app.inject({ method: 'GET', url: '/residency' })).json()).toMatchObject({ max: 2 });
    });

    it('saves a setting that waits for a restart, and leaves the one in use alone', async () => {
        const app = await start({ server: { port: 9000 } });

        const settings = Settings.parse((await patch(app, { server: { port: '9100' } })).json());

        // A number in a string is read as the number, as the contract's numbers always are. § 10.
        expect(settings.values.server.port).toBe(9000);
        expect(field(settings, 'server.port')).toMatchObject({ source: 'database', saved: 9100 });
    });

    it('clears with null, back to the file’s value and then to the default', async () => {
        const app = await start({ residency: { keepAliveSeconds: 60 } }, { 'residency.keepAliveSeconds': 900, 'residency.maxResidentModels': 3 });

        const settings = Settings.parse((await patch(app, { residency: { keepAliveSeconds: null, maxResidentModels: null } })).json());

        expect(settings.values.residency.keepAliveSeconds).toBe(60);
        expect(field(settings, 'residency.keepAliveSeconds')?.source).toBe('config');
        // Null is "clear", never a zero, which here would be a server that could hold nothing.
        expect(settings.values.residency.maxResidentModels).toBe(DEFAULTS.maxResidentModels);
        expect(field(settings, 'residency.maxResidentModels')?.source).toBe('default');
    });

    it('changes an engine’s own keep-alive in the registry', async () => {
        const app = await start({ engines: { tone: { url: 'http://127.0.0.1:9' } } });

        const settings = Settings.parse((await patch(app, { engines: { tone: { keepAliveSeconds: 30 } } })).json());

        expect(settings.values.engines).toEqual({ tone: { keepAliveSeconds: 30 } });
        expect(field(settings, 'engines.tone.keepAliveSeconds')?.source).toBe('database');

        const cleared = Settings.parse((await patch(app, { engines: { tone: { keepAliveSeconds: null } } })).json());
        expect(cleared.values.engines).toEqual({ tone: {} });
    });

    it('turns the update check off at once', async () => {
        const app = await start();

        await patch(app, { update: { check: false } });

        expect((await app.inject({ method: 'GET', url: '/update' })).json()).toMatchObject({ check: 'off' });
    });

    it('cannot turn the update check on over RHAPSODE_UPDATE_CHECK=0', async () => {
        // Whoever set the environment decided the box does not phone out. § 9.
        vi.stubEnv('RHAPSODE_UPDATE_CHECK', '0');
        const app = await start();

        const settings = Settings.parse((await patch(app, { update: { check: true } })).json());

        expect(settings.values.update.check).toBe(false);
        expect((await app.inject({ method: 'GET', url: '/update' })).json()).toMatchObject({ check: 'off' });
    });

    describe('refuses', () => {
        it('a setting the document does not have, naming it', async () => {
            const response = await patch(await start(), { residency: { keepAliveSecs: 30 } });

            expect(response.statusCode).toBe(400);
            expect(response.json().error.code).toBe('bad_request');
            expect(response.json().error.message).toContain('keepAliveSecs');
        });

        it('a value out of range, naming the setting', async () => {
            const response = await patch(await start(), { server: { port: 70000 } });

            expect(response.statusCode).toBe(400);
            expect(response.json().error.message).toContain('server.port');
        });

        it('an origin with a path after it', async () => {
            const response = await patch(await start(), { management: { origins: ['http://tower:8081/'] } });

            expect(response.statusCode).toBe(400);
            expect(response.json().error.message).toContain('http://tower:8081/');
        });

        it('a setting for an engine that is not in the registry', async () => {
            const response = await patch(await start(), { engines: { kokoro: { keepAliveSeconds: 30 } } });

            expect(response.statusCode).toBe(404);
            expect(response.json().error.code).toBe('unknown_engine');
        });

        it('the whole patch, when any of it is refused', async () => {
            const app = await start();

            await patch(app, { residency: { keepAliveSeconds: 30 }, management: { origins: ['not an origin'] } });

            expect(field(await read(app), 'residency.keepAliveSeconds')?.source).toBe('default');
        });

        it('a caller from another machine without the token, before reading the body', async () => {
            const response = await patch(await start(), { residency: { keepAliveSeconds: 30 } }, {}, '10.0.0.5');

            expect(response.statusCode).toBe(403);
            expect(response.json().error.code).toBe('forbidden');
        });

        it('any write on a server with nowhere to keep it', async () => {
            running = await buildServer({}, silent());
            await running.app.ready();

            const response = await patch(running.app, { residency: { keepAliveSeconds: 30 } });

            expect(response.statusCode).toBe(422);
            expect(response.json().error.code).toBe('unsupported');
        });
    });

    describe('a change that would lock its caller out', () => {
        const remote = { authorization: 'Bearer s3cret' };

        it('is refused when a caller on another machine would leave the server with no token', async () => {
            const app = await start({}, { 'management.token': 's3cret' });

            const response = await patch(app, { management: { token: null } }, remote, '10.0.0.5');

            expect(response.statusCode).toBe(409);
            expect(response.json().error.code).toBe('conflict');
            expect(Settings.parse((await patch(app, {}, remote, '10.0.0.5')).json()).values.management.tokenSet).toBe(true);
        });

        it('is refused for an empty token too, which is none', async () => {
            const app = await start({ management: { token: 's3cret' } });

            expect((await patch(app, { management: { token: '' } }, remote, '10.0.0.5')).statusCode).toBe(409);
        });

        it('is allowed at the machine itself, which the guard admits without one', async () => {
            const app = await start({ management: { token: 's3cret' } });

            const settings = Settings.parse((await patch(app, { management: { token: '' } })).json());

            expect(field(settings, 'management.token')).toMatchObject({ source: 'database', saved: true });
        });

        it('allows a caller on another machine to replace the token, which it then knows', async () => {
            const app = await start({ management: { token: 's3cret' } });

            expect((await patch(app, { management: { token: 'n3w' } }, remote, '10.0.0.5')).statusCode).toBe(200);
        });

        it('is refused when a page would leave its own origin out of the list', async () => {
            const app = await start({ management: { token: 's3cret', origins: ['http://tower:8081'] } });
            const page = { ...remote, origin: 'http://tower:8081' };

            expect((await patch(app, { management: { origins: [] } }, page, '10.0.0.5')).statusCode).toBe(409);
            expect((await patch(app, { management: { origins: ['http://tower:8081', 'http://nas:8081'] } }, page, '10.0.0.5')).statusCode).toBe(200);
        });

        it('never refuses a page on this machine, which its origin admits whatever the list says', async () => {
            const app = await start({ management: { origins: ['http://tower:8081'] } });

            const response = await patch(app, { management: { origins: [] } }, { origin: 'http://localhost:8081' });

            expect(response.statusCode).toBe(200);
        });
    });
});
