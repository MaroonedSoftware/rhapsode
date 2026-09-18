import { mkdtempSync, rmSync } from 'node:fs';
import { get } from 'node:https';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { InstallJob } from '@rhapsode/contract';

import { RhapsodeJsonLogger } from '../src/logging/rhapsode.logger.js';
import { loadSettings } from '../src/registry/managed.engines.js';
import { buildServer } from '../src/server.js';

/**
 * One real install, through real pip, of the engine that has no weights.
 *
 * Every other install test fakes the runner, which proves the job machinery and nothing about
 * whether the commands it plans actually build a virtualenv that serves. This is the test that
 * would have caught a plan that installed the adapter without the SDK it depends on, which pip only
 * refuses once it has gone looking for rhapsode-worker on an index that does not have it.
 *
 * It needs the package index (for pip itself and the build backend) and a unix socket, and says it
 * skipped when it has neither rather than passing without having run.
 */
const reachesIndex = await new Promise<boolean>(fulfil => {
    const request = get('https://pypi.org/simple/hatchling/', { timeout: 3_000 }, response => {
        response.resume();
        fulfil(response.statusCode === 200);
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => fulfil(false));
});

const canBindUnixSockets = await (async () => {
    const directory = mkdtempSync(join(tmpdir(), 'rh-probe-'));
    try {
        const server = createServer();
        await new Promise<void>((fulfil, fail) => {
            server.once('error', fail);
            server.listen(join(directory, 'probe.sock'), fulfil);
        });
        await new Promise<void>(fulfil => server.close(() => fulfil()));
        return true;
    } catch {
        return false;
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
})();

const describeReal = reachesIndex && canBindUnixSockets ? describe : describe.skip;
if (!reachesIndex) console.warn('install.real: skipped, pypi.org is not reachable from here');

describeReal('a real install of tone', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rh-real-'));
    let running: Awaited<ReturnType<typeof buildServer>> | undefined;

    afterAll(async () => {
        await running?.app.close();
        rmSync(dir, { recursive: true, force: true });
    });

    it('builds a venv that the core then speaks through, with no restart', { timeout: 300_000 }, async () => {
        const { settings, managed } = await loadSettings(join(dir, 'rhapsode.config.json'));
        running = await buildServer(
            { ...settings, install: { venvDir: join(dir, 'venvs') }, workers: { socketDir: join(dir, 's'), startupTimeoutSeconds: 60 } },
            new RhapsodeJsonLogger('error', () => {}),
            { managed },
        );
        await running.app.ready();
        const { app } = running;

        const { id } = (await app.inject({ method: 'POST', url: '/engines/tone/install' })).json();
        let job: InstallJob;
        do {
            await new Promise(fulfil => setTimeout(fulfil, 250));
            job = InstallJob.parse((await app.inject({ method: 'GET', url: `/installs/${id}` })).json());
        } while (job.state === 'queued' || job.state === 'running');

        expect(job.error).toBeUndefined();
        expect(job.state).toBe('succeeded');

        const spoken = await app.inject({
            method: 'POST',
            url: '/speak',
            headers: { 'content-type': 'application/json' },
            payload: { engine: 'tone', text: 'installed through the API', format: 'wav', stream: false },
        });
        expect(spoken.statusCode).toBe(200);
        expect(spoken.headers['content-type']).toBe('audio/wav');
        expect(spoken.rawPayload.length).toBeGreaterThan(1_000);
    });
});
