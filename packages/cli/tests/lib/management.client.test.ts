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
    });

    afterEach(async () => {
        await running?.app.close();
        running = undefined;
        rmSync(dir, { recursive: true, force: true });
    });

    async function start(): Promise<string> {
        const runner: CommandRunner = async (command, onLine) => {
            onLine(`ran ${command.step}`, 'stdout');
            if (command.step === 'venv') mkdirSync(command.args.at(-1)!, { recursive: true });
        };
        const { settings, managed } = await loadSettings(join(dir, 'rhapsode.config.json'));
        running = await buildServer({ ...settings, install: { venvDir: join(dir, 'venvs') } }, new RhapsodeJsonLogger('error', () => {}), {
            managed,
            runner,
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
        const job = await client.follow((await client.install('tone')).id, event => {
            if (event.kind === 'progress' && event.progress?.status === 'running') steps.push(event.progress.phase);
        });

        expect(job.state).toBe('succeeded');
        expect(steps).toEqual(['venv', 'packages', 'verify', 'register']);
        expect((await client.catalog()).find(entry => entry.id === 'tone')?.installed).toBe('yes');
    });

    it('asks for the weights in the install itself, as a fifth step', async () => {
        const client = new ManagementClient(await start());

        const accepted = await client.install('tone', 'plain');

        expect(accepted).toMatchObject({ kind: 'install', variant: 'plain' });
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
        await client.follow((await client.install('tone')).id, () => {});

        expect(await client.unload('tone')).toMatchObject({ id: 'tone', model: 'unloaded' });
        expect(await client.unload('tone', 'unload')).toMatchObject({ id: 'tone', model: 'unloaded' });
    });

    it('turns an unload of an engine nobody installed into the protocol’s code', async () => {
        const client = new ManagementClient(await start());
        const refused = await client.unload('chatterbox').catch((error: unknown) => error);

        expect(refused).toBeInstanceOf(ManagementError);
        expect(refused).toMatchObject({ code: 'unknown_engine', status: 404 });
    });

    it('says nothing is answering, rather than failing with a socket error', async () => {
        const base = await start();
        await running!.app.close();
        running = undefined;

        await expect(new ManagementClient(base).catalog()).rejects.toBeInstanceOf(ServerUnreachable);
    });
});
