import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildServer, loadSettings, RhapsodeJsonLogger } from '@rhapsode/core';

import { RhapsodeSdk, SdkError, speakStream, type SpeakStreamEvent } from '../src/index.js';

/**
 * The generated client against a real core, because a client generated from the contract and a
 * server hand-written against it agreeing is the claim this package exists to make, and a stubbed
 * fetch would only prove the client agrees with the stub.
 */
describe('RhapsodeSdk against a real core', () => {
    let dir: string;
    let running: Awaited<ReturnType<typeof buildServer>> | undefined;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'rh-sdk-'));
    });

    afterEach(async () => {
        await running?.app.close();
        running = undefined;
        rmSync(dir, { recursive: true, force: true });
    });

    async function sdk(): Promise<RhapsodeSdk> {
        const { settings, managed } = await loadSettings(join(dir, 'rhapsode.config.json'));
        running = await buildServer(settings, new RhapsodeJsonLogger('error', () => {}), { managed });
        await running.app.listen({ host: '127.0.0.1', port: 0 });
        const address = running.app.server.address();
        if (address === null || typeof address === 'string') throw new Error('no port');
        return new RhapsodeSdk({ baseUrl: `http://127.0.0.1:${address.port}` });
    }

    it('reads the catalog and the core’s health', async () => {
        const client = await sdk();

        const catalog = await client.public.catalog();
        expect(catalog.map(entry => entry.id).sort()).toEqual(['breeze', 'chatterbox', 'dia', 'fish', 'kokoro', 'orpheus', 'styletts2', 'tone']);
        expect((await client.public.health()).status).toBe('ok');
    });

    it('returns a declared refusal as a value, with the protocol’s envelope', async () => {
        const client = await sdk();
        const refused = await client.public.uninstallEngine('chatterbox');

        expect(refused.status).toBe(404);
        if (refused.status === 404) expect(refused.data.error.code).toBe('unknown_engine');
    });

    it('carries the guard’s refusal of a foreign page as a declared value', async () => {
        const client = await sdk();
        const base = `http://127.0.0.1:${(running!.app.server.address() as { port: number }).port}`;
        const foreign = new RhapsodeSdk({ baseUrl: base, headers: { origin: 'https://evil.example' } });

        // The same catalog a page on this machine gets: reading it is open to anybody.
        expect(await foreign.public.catalog()).toEqual(await client.public.catalog());
        expect(await foreign.public.installJobs()).toMatchObject({ status: 403, data: { error: { code: 'forbidden' } } });
        expect(await client.public.installJobs()).toMatchObject({ status: 200, data: [] });
    });

    it('throws SdkError for a status an operation does not declare', async () => {
        // /catalog declares only 200. Answering it with anything else is a server that is not a
        // rhapsode, and the client says so rather than handing back a body typed as a catalog.
        const teapot: typeof fetch = async () => new Response('{}', { status: 418, statusText: "I'm a teapot" });
        const original = globalThis.fetch;
        globalThis.fetch = teapot;
        try {
            await expect(new RhapsodeSdk({ baseUrl: 'http://nowhere' }).public.catalog()).rejects.toBeInstanceOf(SdkError);
        } finally {
            globalThis.fetch = original;
        }
    });
});

/**
 * `speakStream` against a real core speaking through the tone engine, for the reason above: the
 * client and the route agreeing is the claim, and only the real route can confirm it. Skipped where
 * Unix sockets cannot be bound, which is where a worker cannot run either.
 */
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

(canBindUnixSockets ? describe : describe.skip)('speakStream against a real core', () => {
    const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
    let dir: string;
    let running: Awaited<ReturnType<typeof buildServer>> | undefined;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'rh-sdk-'));
    });

    afterEach(async () => {
        await running?.app.close();
        running = undefined;
        rmSync(dir, { recursive: true, force: true });
    });

    async function base(): Promise<string> {
        running = await buildServer(
            { workers: { socketDir: dir, startupTimeoutSeconds: 30 }, engines: { tone: { venv: join(REPO, 'python/.venv') } } },
            new RhapsodeJsonLogger('error', () => {}),
        );
        return running.app.listen({ host: '127.0.0.1', port: 0 });
    }

    it('speaks text pushed in pieces, and ends when it is done', async () => {
        const stream = speakStream(await base(), { engine: 'tone', seed: 1 });
        for (const piece of ['Here is one sent', 'ence. And here ', 'is another.']) stream.push(piece);
        stream.end();

        const events: SpeakStreamEvent[] = [];
        for await (const event of stream.events) events.push(event);

        expect(events[0]).toEqual({ type: 'ready', engine: 'tone', variant: 'plain' });
        expect(events[1]).toEqual({ type: 'format', contentType: 'audio/L16; rate=24000; channels=1' });
        expect(events.filter(event => event.type === 'spoken').map(event => event.index)).toEqual([0, 1]);
        const audio = events.flatMap(event => (event.type === 'audio' ? [event.data.length] : [])).reduce((sum, length) => sum + length, 0);
        expect(audio).toBeGreaterThan(0);
    }, 60_000);

    it('throws the protocol’s error from the events', async () => {
        const stream = speakStream(await base(), { engine: 'nope' });
        stream.end();
        const reading = (async () => {
            for await (const _ of stream.events) void _;
        })();
        await expect(reading).rejects.toMatchObject({ name: 'SpeakStreamError', code: 'unknown_engine', retryable: false });
    }, 60_000);
});
