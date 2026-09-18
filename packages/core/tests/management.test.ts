import { afterEach, describe, expect, it } from 'vitest';

import { CatalogEntry } from '@rhapsode/contract';

import { RhapsodeJsonLogger } from '../src/logging/rhapsode.logger.js';
import { sameToken } from '../src/management/management.auth.js';
import { isLoopback, isLoopbackOrigin } from '../src/management/management.access.policy.js';
import { managementGuard } from '../src/management/management.module.js';
import { ManagedEngines } from '../src/registry/managed.engines.js';
import { buildServer } from '../src/server.js';
import type { RhapsodeConfig } from '../src/config.js';

const silent = () => new RhapsodeJsonLogger('error', () => {});
let running: Awaited<ReturnType<typeof buildServer>> | undefined;

/** A server with one extra route behind the guard, standing in for the § 10 routes to come. */
async function start(settings: RhapsodeConfig = {}, managed?: ManagedEngines) {
    const builder = await buildServer(settings, silent(), { managed });
    builder.app.route({ method: ['GET', 'POST'], url: '/guarded', onRequest: managementGuard, handler: async () => ({ ok: true }) });
    running = builder;
    await builder.app.ready();
    return builder;
}

afterEach(async () => {
    await running?.app.close();
    running = undefined;
});

describe('the management guard', () => {
    it.each(['127.0.0.1', '127.8.8.8', '::1', '::ffff:127.0.0.1'])('admits a loopback caller at %s', async remoteAddress => {
        // ::ffff:127.0.0.1 is how 127.0.0.1 arrives on the dual-stack socket the server binds by
        // default. Refusing it would refuse the operator on their own machine.
        const { app } = await start();
        const response = await app.inject({ method: 'GET', url: '/guarded', remoteAddress });
        expect(response.statusCode).toBe(200);
    });

    it('refuses anybody else with a forbidden envelope that says why', async () => {
        const { app } = await start();
        const response = await app.inject({ method: 'GET', url: '/guarded', remoteAddress: '10.0.0.5' });

        expect(response.statusCode).toBe(403);
        expect(response.json().error).toMatchObject({ code: 'forbidden', retryable: false });
        expect(response.json().error.message).toMatch(/loopback/);
    });

    it('refuses a remote bearer token when none is configured', async () => {
        const { app } = await start();
        const response = await app.inject({
            method: 'GET',
            url: '/guarded',
            remoteAddress: '10.0.0.5',
            headers: { authorization: 'Bearer anything' },
        });
        expect(response.statusCode).toBe(403);
    });

    it('admits a remote caller presenting the configured token, and only that one', async () => {
        const { app } = await start({ management: { token: 's3cret' } });
        const call = (authorization?: string) =>
            app.inject({ method: 'GET', url: '/guarded', remoteAddress: '10.0.0.5', headers: authorization ? { authorization } : {} });

        expect((await call('Bearer s3cret')).statusCode).toBe(200);
        expect((await call('Bearer s3cre')).statusCode).toBe(403);
        expect((await call('Bearer s3cret2')).statusCode).toBe(403);
        expect((await call('Basic s3cret')).statusCode).toBe(403);
        expect((await call()).statusCode).toBe(403);
    });

    it('refuses before reading the body', async () => {
        // A refused caller must not be able to make the server buffer an upload first.
        const { app } = await start();
        app.log.level = 'silent';
        const response = await app.inject({
            method: 'GET',
            url: '/guarded',
            remoteAddress: '10.0.0.5',
            headers: { 'content-type': 'text/plain' },
            payload: 'x'.repeat(1024),
        });
        expect(response.statusCode).toBe(403);
    });
});

describe('pages in a browser', () => {
    it('refuses a page from another site, which is what a drive-by POST to localhost looks like', async () => {
        // Measured before this guard existed: this exact request answered 202 and installed tone.
        const { app } = await start();
        const response = await app.inject({ method: 'POST', url: '/guarded', headers: { origin: 'https://evil.example' } });

        expect(response.statusCode).toBe(403);
        expect(response.json().error.message).toMatch(/evil\.example.*management\.origins/);
    });

    it('refuses it even with the token, because a token in a stranger’s page is not the operator', async () => {
        const { app } = await start({ management: { token: 's3cret' } });
        const response = await app.inject({
            method: 'GET',
            url: '/guarded',
            headers: { origin: 'https://evil.example', authorization: 'Bearer s3cret' },
        });
        expect(response.statusCode).toBe(403);
    });

    it('refuses a rebound hostname, whose origin is the attacker’s name however it resolves', async () => {
        const { app } = await start();
        const response = await app.inject({ method: 'POST', url: '/guarded', headers: { origin: 'http://rebind.evil.example:8080' } });
        expect(response.statusCode).toBe(403);
    });

    it.each(['http://localhost:8081', 'http://127.0.0.1:3000', 'http://[::1]:8081', 'https://localhost'])(
        'admits a page served from this machine at %s',
        async origin => {
            const { app } = await start();
            expect((await app.inject({ method: 'POST', url: '/guarded', headers: { origin } })).statusCode).toBe(200);
        },
    );

    it('admits an origin the operator named, and only that one', async () => {
        const { app } = await start({ management: { origins: ['https://rhapsode.home.arpa'] } });
        const call = (origin: string) => app.inject({ method: 'POST', url: '/guarded', headers: { origin } });

        expect((await call('https://rhapsode.home.arpa')).statusCode).toBe(200);
        expect((await call('https://rhapsode.home.arpa.evil.example')).statusCode).toBe(403);
    });

    it('refuses the null origin a sandboxed frame or a file:// page sends', async () => {
        const { app } = await start();
        expect((await app.inject({ method: 'POST', url: '/guarded', headers: { origin: 'null' } })).statusCode).toBe(403);
    });

    it('leaves the catalog open to any page, because it only reads', async () => {
        const { app } = await start();
        expect((await app.inject({ method: 'GET', url: '/catalog', headers: { origin: 'https://evil.example' } })).statusCode).toBe(200);
    });
});

describe('a proxy on this machine', () => {
    it('does not make the client it forwarded for local', async () => {
        // The web app's dev server and nginx both connect from loopback. Without this, serving the
        // web app to the LAN would hand the LAN the install routes.
        const { app } = await start();
        const forwarded = (xff: string) => app.inject({ method: 'GET', url: '/guarded', headers: { 'x-forwarded-for': xff } });

        expect((await forwarded('192.168.1.20')).statusCode).toBe(403);
        expect((await forwarded('127.0.0.1, 192.168.1.20')).statusCode).toBe(403);
        expect((await forwarded('127.0.0.1')).statusCode).toBe(200);
        expect((await forwarded('::1')).statusCode).toBe(200);
    });

    it('still admits a forwarded remote client that holds the token', async () => {
        const { app } = await start({ management: { token: 's3cret' } });
        const response = await app.inject({
            method: 'GET',
            url: '/guarded',
            headers: { 'x-forwarded-for': '192.168.1.20', authorization: 'Bearer s3cret' },
        });
        expect(response.statusCode).toBe(200);
    });

    it('is not believed from a remote peer, where it could only have been written by the caller', async () => {
        const { app } = await start();
        const response = await app.inject({ method: 'GET', url: '/guarded', remoteAddress: '10.0.0.5', headers: { 'x-forwarded-for': '127.0.0.1' } });
        expect(response.statusCode).toBe(403);
    });
});

describe('isLoopbackOrigin', () => {
    it.each([
        ['http://localhost:8081', true],
        ['http://127.0.0.1', true],
        ['http://[::1]:8081', true],
        ['https://localhost', true],
        ['http://localhost.evil.example', false],
        ['http://127.0.0.1.nip.io', false],
        ['file://', false],
        ['null', false],
        ['chrome-extension://abc', false],
    ])('%s is %s', (origin, expected) => {
        expect(isLoopbackOrigin(origin)).toBe(expected);
    });
});

describe('isLoopback', () => {
    it.each([
        ['127.0.0.1', true],
        ['127.255.255.254', true],
        ['::1', true],
        ['::ffff:127.0.0.1', true],
        ['10.0.0.5', false],
        ['::ffff:10.0.0.5', false],
        ['1270.0.0.1', false],
        ['fe80::1', false],
        ['', false],
    ])('%s is %s', (ip, expected) => {
        expect(isLoopback(ip)).toBe(expected);
    });
});

describe('sameToken', () => {
    it('matches only the exact token', () => {
        expect(sameToken('abc', 'abc')).toBe(true);
        expect(sameToken('abd', 'abc')).toBe(false);
        expect(sameToken('ab', 'abc')).toBe(false);
        expect(sameToken('', 'abc')).toBe(false);
    });
});

describe('GET /catalog', () => {
    it('lists every engine that exists, each parsing against the contract', async () => {
        const { app } = await start();
        const catalog = (await app.inject({ method: 'GET', url: '/catalog' })).json();

        expect(catalog.map((entry: CatalogEntry) => entry.id).sort()).toEqual(['chatterbox', 'kokoro', 'tone']);
        for (const entry of catalog) CatalogEntry.parse(entry);
        expect(catalog.find((entry: CatalogEntry) => entry.id === 'chatterbox')).toMatchObject({
            package: 'rhapsode-engine-chatterbox',
            defaultVariant: 'turbo',
            installed: 'no',
            managed: false,
            license: { weights: 'MIT' },
        });
        // § 4: the code licence is what the worker runs. Kokoro's adapter is MIT and phonemizes
        // through GPL code, and this is the one place an operator reads that before installing it.
        expect(catalog.find((entry: CatalogEntry) => entry.id === 'kokoro')).toMatchObject({
            license: { code: 'GPL-3.0-or-later', weights: 'Apache-2.0', weightsCommercialUse: true },
        });
    });

    it('answers a remote caller, because the licences are the point of reading it before install', async () => {
        const { app } = await start();
        const response = await app.inject({ method: 'GET', url: '/catalog', remoteAddress: '10.0.0.5' });
        expect(response.statusCode).toBe(200);
    });

    it('says what this box has, and which of it the API may remove', async () => {
        const settings: RhapsodeConfig = { engines: { tone: { venv: '/v/tone' } } };
        const { app } = await start(settings, ManagedEngines.none(settings));
        const catalog: CatalogEntry[] = (await app.inject({ method: 'GET', url: '/catalog' })).json();

        // Configured by hand: installed, but not the API's to uninstall.
        expect(catalog.find(entry => entry.id === 'tone')).toMatchObject({ installed: 'yes', managed: false });
        expect(catalog.find(entry => entry.id === 'chatterbox')).toMatchObject({ installed: 'no' });
    });
});

describe('ServerKit’s own refusals', () => {
    it('go out as the request’s fault, not the server’s', async () => {
        // They used to fall through to `internal` 500, telling a client with a wrong content type
        // that the server had broken.
        const { app } = await start();
        const response = await app.inject({ method: 'POST', url: '/speak', payload: 'hello', headers: { 'content-type': 'text/plain' } });

        expect(response.statusCode).toBe(400);
        expect(response.json().error).toMatchObject({ code: 'bad_request', message: 'Unsupported Media Type' });
    });
});
