import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FeedEvent } from '@rhapsode/contract';

import { RhapsodeJsonLogger } from '../src/logging/rhapsode.logger.js';
import type { CommandRunner } from '../src/install/command.runner.js';
import { loadSettings } from '../src/registry/managed.engines.js';
import { buildServer } from '../src/server.js';

interface Frame {
    id?: number;
    event?: string;
    data?: FeedEvent;
}

let dir: string;
let running: Awaited<ReturnType<typeof buildServer>> | undefined;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rh-events-'));
});

afterEach(async () => {
    await running?.app.close();
    running = undefined;
    rmSync(dir, { recursive: true, force: true });
});

/** A runner that waits for a release, prints a line per command, and makes the venv directory. */
function heldRunner() {
    let release!: () => void;
    const held = new Promise<void>(fulfil => (release = fulfil));
    const runner: CommandRunner = async (command, onLine) => {
        await held;
        onLine(`ran ${command.step}`, 'stdout');
        if (command.step === 'venv') mkdirSync(command.args.at(-1)!, { recursive: true });
    };
    return { runner, release };
}

async function start(runner: CommandRunner) {
    const { settings, managed } = await loadSettings(join(dir, 'rhapsode.config.json'));
    const builder = await buildServer({ ...settings, install: { venvDir: join(dir, 'venvs') } }, new RhapsodeJsonLogger('error', () => {}), {
        managed,
        runner,
    });
    running = builder;
    await builder.app.listen({ host: '127.0.0.1', port: 0 });
    const address = builder.app.server.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    return { app: builder.app, base: `http://127.0.0.1:${address.port}` };
}

/** Read frames from an SSE response until `until` says stop, then hang up. */
async function frames(url: string, until: (frame: Frame) => boolean, headers: Record<string, string> = {}): Promise<Frame[]> {
    const controller = new AbortController();
    const response = await fetch(url, { headers, signal: controller.signal });
    expect(response.headers.get('content-type')).toBe('text/event-stream');

    const collected: Frame[] = [];
    const decoder = new TextDecoder();
    let buffered = '';
    try {
        for await (const chunk of response.body!) {
            buffered += decoder.decode(chunk, { stream: true });
            let boundary: number;
            while ((boundary = buffered.indexOf('\n\n')) !== -1) {
                const block = buffered.slice(0, boundary);
                buffered = buffered.slice(boundary + 2);
                const frame: Frame = {};
                for (const line of block.split('\n')) {
                    if (line.startsWith('id: ')) frame.id = Number(line.slice(4));
                    else if (line.startsWith('event: ')) frame.event = line.slice(7);
                    else if (line.startsWith('data: ')) frame.data = FeedEvent.parse(JSON.parse(line.slice(6)));
                }
                if (frame.event === undefined && frame.data === undefined) continue; // a heartbeat comment
                collected.push(frame);
                if (until(frame)) return collected;
            }
        }
    } finally {
        controller.abort();
    }
    return collected;
}

const finished = (frame: Frame) => frame.data?.kind === 'progress' && frame.data.progress?.status !== 'running';

describe('GET /installs/{job}/events', () => {
    it('streams a job from queued to done: steps, output, and outcome, all for that job', async () => {
        const { runner, release } = heldRunner();
        const { app, base } = await start(runner);
        const { id } = (await app.inject({ method: 'POST', url: '/engines/tone/install' })).json();

        const reading = frames(`${base}/installs/${id}/events`, finished);
        release();
        const received = await reading;
        const events = received.map(frame => frame.data!);

        expect(events.every(event => event.correlationId === id)).toBe(true);
        expect(events[0]).toMatchObject({ kind: 'status', message: 'install tone queued' });
        expect(events.filter(event => event.kind === 'progress' && event.progress?.status === 'running').map(event => event.progress?.phase)).toEqual(
            ['venv', 'packages', 'verify', 'register'],
        );
        expect(events.filter(event => event.kind === 'log').map(event => event.message)).toContain('ran packages');
        expect(events.at(-1)?.progress).toMatchObject({ status: 'done', index: 4, total: 4 });

        const ids = received.map(frame => frame.id!);
        expect([...ids].sort((a, b) => a - b)).toEqual(ids);
    });

    it('replays a finished job from the start, and resumes after Last-Event-ID', async () => {
        const { runner, release } = heldRunner();
        const { app, base } = await start(runner);
        const { id } = (await app.inject({ method: 'POST', url: '/engines/tone/install' })).json();
        release();
        const everything = await frames(`${base}/installs/${id}/events`, finished);

        const middle = everything[Math.floor(everything.length / 2)]!.id!;
        const resumed = await frames(`${base}/installs/${id}/events`, finished, { 'last-event-id': String(middle) });

        expect(resumed[0]!.id).toBeGreaterThan(middle);
        expect(resumed.map(frame => frame.id)).toEqual(everything.filter(frame => frame.id! > middle).map(frame => frame.id));
    });

    it('will not widen to another job’s output through the query string', async () => {
        const { runner, release } = heldRunner();
        const { app, base } = await start(runner);
        const tone = (await app.inject({ method: 'POST', url: '/engines/tone/install' })).json();
        const chatterbox = (await app.inject({ method: 'POST', url: '/engines/chatterbox/install' })).json();
        release();

        const received = await frames(`${base}/installs/${tone.id}/events?correlationId=${chatterbox.id}`, finished);
        expect(received.every(frame => frame.data?.correlationId === tone.id)).toBe(true);
    });

    it('refuses a remote caller before opening a stream, and names an unknown job', async () => {
        const { runner } = heldRunner();
        const { app } = await start(runner);
        const { id } = (await app.inject({ method: 'POST', url: '/engines/tone/install' })).json();

        const remote = await app.inject({ method: 'GET', url: `/installs/${id}/events`, remoteAddress: '10.0.0.5' });
        expect(remote.statusCode).toBe(403);
        expect(remote.headers['content-type']).toMatch(/application\/json/);

        const unknown = await app.inject({ method: 'GET', url: '/installs/nope/events' });
        expect(unknown.statusCode).toBe(404);
    });
});
