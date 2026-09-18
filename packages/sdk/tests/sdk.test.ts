import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildServer, loadSettings, RhapsodeJsonLogger } from '@rhapsode/core';

import { RhapsodeSdk, SdkError } from '../src/index.js';

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
        expect(catalog.map(entry => entry.id).sort()).toEqual(['chatterbox', 'kokoro', 'tone']);
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

        expect(await foreign.public.catalog()).toHaveLength(3);
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
