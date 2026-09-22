import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildServer } from '../src/server.js';
import { RhapsodeJsonLogger } from '../src/logging/rhapsode.logger.js';
import { CORE_VERSION } from '../src/core.version.js';
import type { RhapsodeConfig } from '../src/config.js';

const silent = () => new RhapsodeJsonLogger('error', () => {});

let running: Awaited<ReturnType<typeof buildServer>> | undefined;

afterEach(async () => {
    await running?.app.close();
    running = undefined;
});

async function start(settings: RhapsodeConfig, fetcher: typeof fetch) {
    running = await buildServer(settings, silent(), { fetch: fetcher });
    await running.app.ready();
    return running;
}

/** A GitHub that answers with a release once `release()` is called, and counts what it was asked. */
function slowGithub(tag: string) {
    let release!: () => void;
    const gate = new Promise<void>(fulfil => (release = fulfil));
    let calls = 0;
    const fetcher = (async () => {
        calls += 1;
        await gate;
        return new Response(JSON.stringify({ tag_name: tag, html_url: `https://example.test/${tag}` }), { status: 200 });
    }) as typeof fetch;
    return { fetcher, release, calls: () => calls };
}

describe('GET /update', () => {
    it('answers at once while GitHub has not, then with what it said', async () => {
        const github = slowGithub('v999.0.0');
        const builder = await start({}, github.fetcher);

        const first = await builder.app.inject({ method: 'GET', url: '/update' });
        expect(first.statusCode).toBe(200);
        expect(first.json()).toMatchObject({ version: CORE_VERSION, check: 'pending' });

        github.release();
        await vi.waitFor(async () => {
            const second = (await builder.app.inject({ method: 'GET', url: '/update' })).json();
            expect(second).toMatchObject({ check: 'ok', latest: '999.0.0', updateAvailable: true, releaseUrl: 'https://example.test/v999.0.0' });
        });
        expect(github.calls()).toBe(1);
    });

    it('answers a caller from anywhere, as /catalog does', async () => {
        const builder = await start({ update: { check: false } }, slowGithub('v0.0.0').fetcher);
        const response = await builder.app.inject({
            method: 'GET',
            url: '/update',
            remoteAddress: '10.0.0.5',
            headers: { origin: 'https://evil.example' },
        });

        expect(response.statusCode).toBe(200);
    });

    it('never asks when the config turns it off', async () => {
        const github = slowGithub('v999.0.0');
        const builder = await start({ update: { check: false } }, github.fetcher);

        expect((await builder.app.inject({ method: 'GET', url: '/update' })).json()).toMatchObject({ check: 'off' });
        expect(github.calls()).toBe(0);
    });

    it('leaves /health alone while a check is outstanding', async () => {
        const builder = await start({}, slowGithub('v999.0.0').fetcher);
        await builder.app.inject({ method: 'GET', url: '/update' });

        const health = (await builder.app.inject({ method: 'GET', url: '/health' })).json();
        expect(health).toMatchObject({ status: 'ok', version: CORE_VERSION });
        expect(health).not.toHaveProperty('check');
    });
});
