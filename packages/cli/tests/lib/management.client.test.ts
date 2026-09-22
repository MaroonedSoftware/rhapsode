import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildServer, loadSettings, RhapsodeJsonLogger, type CommandRunner } from '@rhapsode/core';
import type { FeedEvent } from '@rhapsode/contract';

import {
    describeLicense,
    isFinal,
    ManagementClient,
    ManagementError,
    serverBase,
    ServerUnreachable,
    SseFrames,
} from '../../src/lib/management.client.js';

describe('SseFrames', () => {
    it('holds a frame split across chunks until it is whole', () => {
        const frames = new SseFrames();
        expect(frames.push('id: 1\nevent: server.feed\nda')).toEqual([]);
        expect(frames.push('ta: {"a":1}\n\nid: 2\n')).toEqual([{ id: 1, event: 'server.feed', data: '{"a":1}' }]);
        expect(frames.push('data: x\n\n')).toEqual([{ id: 2, data: 'x' }]);
    });

    it('skips a heartbeat and joins multi-line data, whatever the line endings', () => {
        const frames = new SseFrames();
        expect(frames.push(': ping\n\ndata: one\r\ndata: two\r\n\r\n')).toEqual([{ data: 'one\ntwo' }]);
    });
});

describe('the small helpers', () => {
    it('asks loopback by address, which the guard admits whatever localhost resolves to', () => {
        expect(serverBase(8080)).toBe('http://127.0.0.1:8080');
        expect(serverBase(8080, 'http://gpu-02.lan:8080/')).toBe('http://gpu-02.lan:8080');
    });

    it('names the weights licence separately, and says so when commercial use is not allowed', () => {
        expect(describeLicense({ code: 'Apache-2.0', weights: 'CC-BY-NC-4.0', weightsCommercialUse: false })).toBe(
            'code Apache-2.0, weights CC-BY-NC-4.0 (NOT for commercial use)',
        );
    });

    it('knows a job’s last event', () => {
        const progress = (status: 'running' | 'done' | 'failed') =>
            ({
                id: 1,
                ts: '',
                source: 'install',
                level: 'info',
                kind: 'progress',
                progress: { phase: 'venv', index: 1, total: 4, status },
            }) as FeedEvent;
        expect(isFinal(progress('running'))).toBe(false);
        expect(isFinal(progress('done'))).toBe(true);
        expect(isFinal(progress('failed'))).toBe(true);
    });
});

describe('ManagementClient against a real core', () => {
    let dir: string;
    let running: Awaited<ReturnType<typeof buildServer>> | undefined;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'rh-cli-'));
        workerVersion = undefined;
    });

    afterEach(async () => {
        await running?.app.close();
        running = undefined;
        rmSync(dir, { recursive: true, force: true });
    });

    /** The `rhapsode-worker` the fake runner puts in each venv it builds. */
    let workerVersion: string | undefined;

    async function start(): Promise<string> {
        const runner: CommandRunner = async (command, onLine) => {
            onLine(`ran ${command.step}`, 'stdout');
            if (command.step !== 'venv') return;
            mkdirSync(command.args.at(-1)!, { recursive: true });
            if (workerVersion !== undefined) {
                mkdirSync(join(command.args.at(-1)!, 'lib', 'python3.12', 'site-packages', `rhapsode_worker-${workerVersion}.dist-info`), {
                    recursive: true,
                });
            }
        };
        // A GitHub that is always on 0.0.1, so no test here asks the real one.
        const github = (async () => new Response(JSON.stringify({ tag_name: 'v0.0.1' }), { status: 200 })) as typeof fetch;
        const { settings, managed } = await loadSettings(join(dir, 'rhapsode.config.json'));
        running = await buildServer({ ...settings, install: { venvDir: join(dir, 'venvs') } }, new RhapsodeJsonLogger('error', () => {}), {
            managed,
            runner,
            fetch: github,
        });
        await running.app.listen({ host: '127.0.0.1', port: 0 });
        const address = running.app.server.address();
        if (address === null || typeof address === 'string') throw new Error('no port');
        return `http://127.0.0.1:${address.port}`;
    }

    it('reads the catalog, installs, and follows the job to its end', async () => {
        const client = new ManagementClient(await start());
        expect((await client.catalog()).find(entry => entry.id === 'tone')?.installed).toBe('no');

        const steps: string[] = [];
        const job = await client.follow((await client.install('tone', 'MIT')).id, event => {
            if (event.kind === 'progress' && event.progress?.status === 'running') steps.push(event.progress.phase);
        });

        expect(job.state).toBe('succeeded');
        expect(steps).toEqual(['venv', 'packages', 'verify', 'register']);
        expect((await client.catalog()).find(entry => entry.id === 'tone')?.installed).toBe('yes');
    });

    it('asks for the weights in the install itself, as a fifth step', async () => {
        const client = new ManagementClient(await start());

        const accepted = await client.install('tone', 'MIT', 'plain');

        expect(accepted).toMatchObject({ kind: 'install', variant: 'plain' });
    });

    it('reads the settings and changes one, the way the web page does', async () => {
        const client = new ManagementClient(await start());
        expect((await client.settings()).values.residency.keepAliveSeconds).toBe(300);

        const after = await client.updateSettings({ residency: { keepAliveSeconds: 900 } });

        expect(after.values.residency.keepAliveSeconds).toBe(900);
        expect(after.fields.find(field => field.key === 'residency.keepAliveSeconds')?.source).toBe('database');
    });

    it('turns a refusal into the protocol’s code and message', async () => {
        const client = new ManagementClient(await start());
        const refused = await client.pull('chatterbox').catch((error: unknown) => error);

        expect(refused).toBeInstanceOf(ManagementError);
        expect(refused).toMatchObject({ code: 'unknown_engine', status: 404 });
    });

    it('reads what is resident, on a server holding nothing', async () => {
        const client = new ManagementClient(await start());

        expect(await client.residency()).toEqual({ resident: 0, max: 1, waiting: 0, models: [] });
    });

    it('unloads an engine that is holding nothing, because the state asked for is already true', async () => {
        const client = new ManagementClient(await start());
        await client.follow((await client.install('tone', 'MIT')).id, () => {});

        expect(await client.unload('tone')).toMatchObject({ id: 'tone', model: 'unloaded' });
        expect(await client.unload('tone', 'unload')).toMatchObject({ id: 'tone', model: 'unloaded' });
    });

    it('turns an unload of an engine nobody installed into the protocol’s code', async () => {
        const client = new ManagementClient(await start());
        const refused = await client.unload('chatterbox').catch((error: unknown) => error);

        expect(refused).toBeInstanceOf(ManagementError);
        expect(refused).toMatchObject({ code: 'unknown_engine', status: 404 });
    });

    it('lists engines with what an upgrade left behind, and reinstalls them all', async () => {
        workerVersion = '0.0.1';
        const client = new ManagementClient(await start());
        await client.follow((await client.install('tone', 'MIT')).id, () => {});

        expect(await client.engines()).toEqual([expect.objectContaining({ id: 'tone', workerVersion: '0.0.1', outdated: true })]);

        const answer = await client.reinstallOutdated();
        expect(answer.skipped).toEqual([]);
        expect(answer.jobs.map(job => [job.engine, job.kind])).toEqual([['tone', 'reinstall']]);
        expect((await client.follow(answer.jobs[0]!.id, () => {})).state).toBe('succeeded');
    });

    it('reinstalls one engine, and turns a refusal into the protocol’s code', async () => {
        const client = new ManagementClient(await start());
        expect(await client.reinstall('tone').catch((error: unknown) => error)).toMatchObject({ code: 'unknown_engine', status: 404 });

        await client.follow((await client.install('tone', 'MIT')).id, () => {});
        const job = await client.reinstall('tone', 'MIT');
        expect(job).toMatchObject({ engine: 'tone', kind: 'reinstall' });
        expect((await client.follow(job.id, () => {})).state).toBe('succeeded');
    });

    it('asks for the latest release now, and gets the answer rather than pending', async () => {
        const client = new ManagementClient(await start());

        expect(await client.checkForUpdate()).toMatchObject({ check: 'ok', latest: '0.0.1', updateAvailable: false });
    });

    it('reads the update status, which answers at once whatever GitHub is doing', async () => {
        const client = new ManagementClient(await start());

        const status = await client.updateStatus();
        expect(['pending', 'ok']).toContain(status.check);
        expect(status.distribution).toBe('source');
    });

    it('says nothing is answering, rather than failing with a socket error', async () => {
        const base = await start();
        await running!.app.close();
        running = undefined;

        await expect(new ManagementClient(base).catalog()).rejects.toBeInstanceOf(ServerUnreachable);
    });
});
