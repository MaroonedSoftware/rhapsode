import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { InstallJob } from '@rhapsode/contract';

import { RhapsodeJsonLogger } from '../src/logging/rhapsode.logger.js';
import { buildServer } from '../src/server.js';
import type { RhapsodeConfig } from '../src/config.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const PYTHON = join(REPO, 'python/.venv/bin/python');
const WORKER_TESTS = join(REPO, 'python/rhapsode-worker/tests');
const MIT = { code: 'MIT', weights: 'MIT', weightsCommercialUse: true };

const canBindUnixSockets = await (async () => {
    const directory = mkdtempSync(join(tmpdir(), 'rh-probe-'));
    try {
        const server = createServer();
        await new Promise<void>((fulfil, fail) => {
            server.once('error', fail);
            server.listen(join(directory, 'p.sock'), fulfil);
        });
        await new Promise<void>(fulfil => server.close(() => fulfil()));
        return true;
    } catch {
        return false;
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
})();

const describeWithSockets = canBindUnixSockets ? describe : describe.skip;

let running: Awaited<ReturnType<typeof buildServer>> | undefined;
let dir: string | undefined;

afterEach(async () => {
    await running?.app.close();
    running = undefined;
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
});

/** Tone, which has no weights to fetch, and the test engine, which records that it fetched. */
async function start() {
    dir = mkdtempSync(join(tmpdir(), 'rh-pull-'));
    const engines: RhapsodeConfig['engines'] = {
        tone: { venv: join(REPO, 'python/.venv') },
        failing: {
            displayName: 'Failing',
            license: MIT,
            command: PYTHON,
            args: ['-m', 'engines.failing'],
            cwd: REPO,
            defaultVariant: 'only',
            env: { PYTHONPATH: WORKER_TESTS, RHAPSODE_TEST_MODE: 'ok', RHAPSODE_TEST_PROGRESS: join(dir, 'progress') },
        },
    };
    running = await buildServer(
        { workers: { socketDir: join(dir, 's'), startupTimeoutSeconds: 30 }, engines },
        new RhapsodeJsonLogger('error', () => {}),
    );
    await running.app.ready();
    return running.app;
}

async function settled(app: Awaited<ReturnType<typeof start>>, id: string): Promise<InstallJob> {
    for (let attempt = 0; attempt < 600; attempt += 1) {
        const job = InstallJob.parse((await app.inject({ method: 'GET', url: `/installs/${id}` })).json());
        if (job.state === 'succeeded' || job.state === 'failed') return job;
        await new Promise(fulfil => setTimeout(fulfil, 50));
    }
    throw new Error(`job ${id} never settled`);
}

const pull = (app: Awaited<ReturnType<typeof start>>, engine: string, payload: unknown = {}, remoteAddress?: string) =>
    app.inject({
        method: 'POST',
        url: `/engines/${engine}/pull`,
        payload: payload as Record<string, unknown>,
        headers: { 'content-type': 'application/json' },
        ...(remoteAddress === undefined ? {} : { remoteAddress }),
    });

describeWithSockets('POST /engines/{engine}/pull', () => {
    it('fetches the default variant through the worker, and loads nothing', { timeout: 60_000 }, async () => {
        const app = await start();
        const accepted = await pull(app, 'failing');
        expect(accepted.statusCode).toBe(202);

        const job = await settled(app, accepted.json().id);

        expect(job).toMatchObject({ kind: 'pull', variant: 'only', state: 'succeeded', step: 'weights' });
        expect(readFileSync(join(dir!, 'progress'), 'utf8')).toBe('fetched only\n');
        const engines = (await app.inject({ method: 'GET', url: '/engines' })).json();
        expect(engines.find((engine: { id: string }) => engine.id === 'failing')).toMatchObject({ process: 'up', model: 'unloaded' });
    });

    it('fails the job as unsupported for an engine with no weights to fetch', { timeout: 60_000 }, async () => {
        const app = await start();
        const job = await settled(app, (await pull(app, 'tone', { variant: 'plain' })).json().id);

        expect(job.state).toBe('failed');
        expect(job.error).toMatchObject({ code: 'unsupported' });
        expect(existsSync(join(dir!, 'progress'))).toBe(false);
    });

    it('refuses what it can before a job exists', async () => {
        const app = await start();

        expect((await pull(app, 'chatterbox')).json().error.code).toBe('unknown_engine');
        expect((await pull(app, 'failing', { variant: 3 })).statusCode).toBe(400);
        expect((await pull(app, 'failing', {}, '10.0.0.5')).statusCode).toBe(403);
    });
});
