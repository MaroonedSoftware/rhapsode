import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ResidencyDetail } from '@rhapsode/contract';

import { CORE_VERSION } from '../src/core.version.js';
import { buildServer } from '../src/server.js';
import { RhapsodeJsonLogger } from '../src/logging/rhapsode.logger.js';
import type { RhapsodeConfig } from '../src/config.js';

const silent = () => new RhapsodeJsonLogger('error', () => {});

let running: Awaited<ReturnType<typeof buildServer>> | undefined;

async function start(settings: RhapsodeConfig = {}) {
    const builder = await buildServer(settings, silent());
    running = builder;
    await builder.app.ready();
    return builder;
}

afterEach(async () => {
    await running?.app.close();
    running = undefined;
});

describe('GET /health', () => {
    it('answers with no engines at all', async () => {
        // It must answer while every worker is down and must never block on one. A health endpoint
        // that waits on the thing it reports about times out exactly when you need it.
        const builder = await start();
        const response = await builder.app.inject({ method: 'GET', url: '/health' });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({ contract: 1, status: 'ok', engines: [] });
    });

    it('carries the core’s own version, for display', async () => {
        const builder = await start();
        expect(response(await builder.app.inject({ method: 'GET', url: '/health' })).version).toBe(CORE_VERSION);
    });

    it('says which engines an upgrade left behind, and so does the catalog', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'rh-outdated-'));
        try {
            const venv = join(dir, 'tone');
            mkdirSync(join(venv, 'lib', 'python3.12', 'site-packages', 'rhapsode_worker-0.0.1.dist-info'), { recursive: true });
            const builder = await start({ engines: { tone: { venv } } });

            const health = response(await builder.app.inject({ method: 'GET', url: '/health' }));
            expect(health.engines[0]).toMatchObject({ id: 'tone', workerVersion: '0.0.1', outdated: true });

            const catalog = (await builder.app.inject({ method: 'GET', url: '/catalog' })).json();
            expect(catalog.find((entry: { id: string }) => entry.id === 'tone')).toMatchObject({ workerVersion: '0.0.1', outdated: true });
            expect(catalog.find((entry: { id: string }) => entry.id === 'kokoro')).not.toHaveProperty('outdated');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('reports the residency budget', async () => {
        const builder = await start({ residency: { maxResidentModels: 2 } });
        expect(response(await builder.app.inject({ method: 'GET', url: '/health' })).residency).toEqual({
            resident: 0,
            max: 2,
            waiting: 0,
        });
    });
});

describe('GET /residency', () => {
    it('answers with nothing resident, and spawns nothing to do it', async () => {
        // The route an operator reads when a card is full. Asking each worker would make "what is
        // loaded" a reason to start processes that are not, which is the opposite of the question.
        const builder = await start({ engines: { tone: { venv: '/nowhere' } }, residency: { maxResidentModels: 2 } });
        const residency = response(await builder.app.inject({ method: 'GET', url: '/residency' }));

        expect(residency).toEqual({ resident: 0, max: 2, waiting: 0, models: [] });

        const engines = response(await builder.app.inject({ method: 'GET', url: '/engines' }));
        expect(engines[0]).toMatchObject({ process: 'down', model: 'unloaded' });
    });

    it('parses against the contract', async () => {
        const builder = await start();
        const parsed = ResidencyDetail.safeParse(response(await builder.app.inject({ method: 'GET', url: '/residency' })));

        expect(parsed.success).toBe(true);
    });
});

describe('GET /engines', () => {
    it('lists a declared engine as down, without spawning anything', async () => {
        // This is the list an operator reads to find out what is installed. Starting a process to
        // answer it would make that cost a cold start every time.
        const builder = await start({ engines: { tone: { venv: '/nowhere' } } });
        const engines = response(await builder.app.inject({ method: 'GET', url: '/engines' }));

        expect(engines).toHaveLength(1);
        expect(engines[0]).toMatchObject({ id: 'tone', process: 'down', model: 'unloaded', restarts: 0 });
    });

    it('carries both licences, so the weights licence is visible before install', async () => {
        const builder = await start({ engines: { tone: { venv: '/nowhere' } } });
        const engines = response(await builder.app.inject({ method: 'GET', url: '/engines' }));

        expect(engines[0].license).toMatchObject({ code: 'MIT', weights: 'MIT', weightsCommercialUse: true });
    });

    it('refuses to start when a configured engine has no licence anywhere', async () => {
        // A licence scanner reads the package and reports the code licence, and is wrong in the way
        // that matters. An engine nobody can see the weights licence for should not be startable.
        await expect(buildServer({ engines: { mystery: { venv: '/nowhere' } } }, silent())).rejects.toThrow(/nothing knows its licence/);
    });

    it('skips an engine that is configured but disabled', async () => {
        const builder = await start({ engines: { tone: { venv: '/nowhere', enabled: false } } });
        expect(response(await builder.app.inject({ method: 'GET', url: '/engines' }))).toEqual([]);
    });
});

describe('failures', () => {
    it('renders a missing route as the protocol envelope', async () => {
        const builder = await start();
        const result = await builder.app.inject({ method: 'GET', url: '/nope' });

        expect(result.statusCode).toBe(404);
        expect(result.json()).toEqual({
            error: { code: 'bad_request', message: 'no route for GET /nope', retryable: false },
        });
    });

    it('always carries code, message and retryable', async () => {
        // retryable is a field rather than something a caller infers from the status, because a
        // caller that conflates "wrong request" with "server was busy" either retries forever or
        // throws away work that would have succeeded.
        const builder = await start();
        const body = (await builder.app.inject({ method: 'GET', url: '/nope' })).json();
        expect(Object.keys(body.error).sort()).toEqual(['code', 'message', 'retryable']);
    });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function response(result: { json: () => any }): any {
    return result.json();
}
