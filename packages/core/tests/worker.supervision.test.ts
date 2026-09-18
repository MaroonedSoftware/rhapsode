import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildServer } from '../src/server.js';
import { RhapsodeJsonLogger } from '../src/logging/rhapsode.logger.js';
import { resolveCommand } from '../src/workers/worker.handle.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const VENV = join(REPO, 'python/.venv');

/**
 * Some sandboxes create the socket file happily and refuse the bind, which is not a failure of this
 * code. Probing for real is the only reliable answer: the capability cannot be inferred from the
 * platform, and a suite that passes because it never ran is worse than one that says it skipped.
 */
const canBindUnixSockets = await (async () => {
    const directory = mkdtempSync(join(tmpdir(), 'rh-probe-'));
    const path = join(directory, 'probe.sock');
    try {
        const server = createServer();
        await new Promise<void>((fulfil, fail) => {
            server.once('error', fail);
            server.listen(path, fulfil);
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

const silent = () => new RhapsodeJsonLogger('error', () => {});

let running: Awaited<ReturnType<typeof buildServer>> | undefined;
let socketDir: string | undefined;

afterEach(async () => {
    await running?.app.close();
    running = undefined;
    if (socketDir !== undefined) rmSync(socketDir, { recursive: true, force: true });
    socketDir = undefined;
});

async function start(engine: Record<string, unknown>) {
    socketDir = mkdtempSync(join(tmpdir(), 'rh-'));
    const builder = await buildServer({ workers: { socketDir, startupTimeoutSeconds: 30 }, engines: { tone: engine } }, silent());
    running = builder;
    await builder.app.ready();
    return builder;
}

describe('resolveCommand', () => {
    it('derives python -m module from a venv', () => {
        const { command, args } = resolveCommand({
            id: 'tone',
            displayName: 'Tone',
            license: { code: 'MIT', weights: 'MIT', weightsCommercialUse: true },
            venv: '/opt/venvs/tone',
            module: 'rhapsode_engine_tone',
        });
        expect(command).toMatch(/\/opt\/venvs\/tone\/(bin\/python|Scripts\/python\.exe)$/);
        expect(args).toEqual(['-m', 'rhapsode_engine_tone']);
    });

    it('lets an explicit command win, which is the one escape hatch', () => {
        const { command, args } = resolveCommand({
            id: 'tone',
            displayName: 'Tone',
            license: { code: 'MIT', weights: 'MIT', weightsCommercialUse: true },
            venv: '/ignored',
            module: 'ignored',
            command: '/usr/bin/env',
            args: ['python3', '-m', 'thing'],
        });
        expect(command).toBe('/usr/bin/env');
        expect(args).toEqual(['python3', '-m', 'thing']);
    });

    it('refuses an engine with nothing to derive a command from', () => {
        expect(() => resolveCommand({ id: 'x', displayName: 'X', license: { code: 'MIT', weights: 'MIT', weightsCommercialUse: true } })).toThrow(
            /neither a command nor a venv/,
        );
    });
});

describeWithSockets('supervising a real worker', () => {
    it('spawns on demand and proxies the capability document', async () => {
        const builder = await start({ venv: VENV });
        const response = await builder.app.inject({ method: 'GET', url: '/engines/tone/capabilities' });

        expect(response.statusCode).toBe(200);
        const capabilities = response.json();
        expect(capabilities.contract).toBe(1);
        expect(Object.keys(capabilities.variants)).toEqual(['plain', 'dialled']);
        // Asking what an engine can do brings the process up, which is cheap, and leaves the model
        // alone, which is not. Section 3 keeps those two apart for exactly this reason.
        expect(capabilities.current).toBeUndefined();
    }, 60_000);

    it('rewrites previewUrl, which is the one field it edits while proxying', async () => {
        // A worker answers /voices/{id}/preview, which is right on its own socket and a 404 to
        // anybody who followed it from the public API.
        const builder = await start({ venv: VENV });
        const voices = (await builder.app.inject({ method: 'GET', url: '/engines/tone/voices' })).json();

        expect(voices.length).toBeGreaterThan(0);
        for (const voice of voices) {
            expect(voice.previewUrl).toBe(`/engines/tone/voices/${voice.id}/preview`);
        }
    }, 60_000);

    it('reports an interpreter that does not exist at once, rather than waiting for a timeout', async () => {
        // A command that does not exist never runs and never exits: it emits `error`. Nothing
        // listening makes that an uncaught exception that takes the core down over one engine's
        // wrong venv path, and waiting for the startup timeout is the wrong failure mode anyway.
        const builder = await start({ venv: '/nowhere/at/all' });

        const began = Date.now();
        const response = await builder.app.inject({ method: 'GET', url: '/engines/tone/capabilities' });

        expect(response.statusCode).toBe(503);
        expect(response.json().error).toMatchObject({ code: 'model_unavailable', retryable: true });
        expect(response.json().error.message).toContain('ENOENT');
        expect(Date.now() - began).toBeLessThan(5_000);
    }, 60_000);

    it('reports a worker that dies before its handshake, with what it said', async () => {
        // A worker that exits before printing has failed to start, and its stderr is the error
        // message. That is the mechanism; a timeout is only the backstop.
        const builder = await start({ command: process.execPath, args: ['-e', 'console.error("no thanks"); process.exit(3)'] });
        const response = await builder.app.inject({ method: 'GET', url: '/engines/tone/capabilities' });

        expect(response.statusCode).toBe(503);
        expect(response.json().error.message).toContain('no thanks');
    }, 60_000);

    it('refuses an engine it was never told about', async () => {
        const builder = await start({ venv: VENV });
        const response = await builder.app.inject({ method: 'GET', url: '/engines/chatterbox/capabilities' });

        expect(response.statusCode).toBe(404);
        expect(response.json().error).toMatchObject({ code: 'unknown_engine', retryable: false });
        expect(response.json().error.message).toContain('tone');
    });
});
