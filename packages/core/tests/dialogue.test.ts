import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { buildServer } from '../src/server.js';
import { RhapsodeJsonLogger } from '../src/logging/rhapsode.logger.js';
import type { RhapsodeConfig } from '../src/config.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const PYTHON = join(REPO, 'python/.venv/bin/python');
const WORKER_TESTS = join(REPO, 'python/rhapsode-worker/tests');

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

const MIT = { code: 'MIT', weights: 'MIT', weightsCommercialUse: true };

let running: Awaited<ReturnType<typeof buildServer>> | undefined;
let socketDir: string | undefined;

afterEach(async () => {
    await running?.app.close();
    running = undefined;
    if (socketDir !== undefined) rmSync(socketDir, { recursive: true, force: true });
    socketDir = undefined;
});

/** The tone engine, which is honest, or a misbehaving one chosen by mode. */
async function start(mode?: string, extra: Partial<RhapsodeConfig> = {}) {
    socketDir = mkdtempSync(join(tmpdir(), 'rh-'));
    const engines: RhapsodeConfig['engines'] =
        mode === undefined
            ? { tone: { venv: join(REPO, 'python/.venv') } }
            : {
                  failing: {
                      displayName: 'Failing',
                      license: MIT,
                      command: PYTHON,
                      args: ['-m', 'engines.failing'],
                      cwd: REPO,
                      env: { PYTHONPATH: WORKER_TESTS, RHAPSODE_TEST_MODE: mode },
                  },
              };

    const builder = await buildServer(
        { workers: { socketDir, startupTimeoutSeconds: 30 }, engines, ...extra },
        new RhapsodeJsonLogger('error', () => {}),
    );
    running = builder;
    await builder.app.ready();
    return builder;
}

const dialogue = (builder: Awaited<ReturnType<typeof buildServer>>, engine: string, payload: Record<string, unknown>) =>
    builder.app.inject({ method: 'POST', url: `/engines/${engine}/dialogue`, payload, headers: { 'content-type': 'application/json' } });

const TURNS = [
    { speaker: 'a', text: 'Did you hear that?' },
    { speaker: 'b', text: 'It is only the cat.' },
    { speaker: 'a', text: 'It is never only the cat.' },
];

describe('refusals that happen before anything is committed', () => {
    it('refuses an engine it was never told about', async () => {
        const builder = await start();
        const response = await dialogue(builder, 'dia', { turns: TURNS });

        expect(response.statusCode).toBe(404);
        expect(response.json().error).toMatchObject({ code: 'unknown_engine', retryable: false });
    });

    it('refuses a turn without a speaker, and says where it is', async () => {
        const builder = await start();
        const response = await dialogue(builder, 'tone', { turns: [{ text: 'Who said this?' }] });

        expect(response.statusCode).toBe(400);
        expect(response.json().error.message).toContain('`turns.0.speaker`');
    });

    it('refuses a delivery, which a conversation of several readers has no one meaning for', async () => {
        const builder = await start();
        const response = await dialogue(builder, 'tone', { turns: TURNS, delivery: 'hushed' });

        expect(response.statusCode).toBe(400);
        expect(response.json().error).toMatchObject({ code: 'bad_request' });
    });
});

describeWithSockets('a conversation', () => {
    it('is one take, buffered with its length and duration', async () => {
        const builder = await start();
        const response = await dialogue(builder, 'tone', { turns: TURNS, format: 'pcm', stream: false });

        expect(response.statusCode).toBe(200);
        expect(response.headers['content-type']).toBe('audio/L16; rate=24000; channels=1');
        expect(Number(response.headers['content-length'])).toBe(response.rawPayload.length);
        expect(Number(response.headers['x-rhapsode-duration-ms'])).toBe(Math.round((response.rawPayload.length / 2 / 24_000) * 1000));
    }, 60_000);

    it('streams like a line does', async () => {
        const builder = await start();
        const response = await dialogue(builder, 'tone', { turns: TURNS, format: 'wav', stream: true });

        expect(response.statusCode).toBe(200);
        expect(response.rawPayload.subarray(0, 4).toString()).toBe('RIFF');
        expect(response.rawPayload.length).toBeGreaterThan(256);
    }, 60_000);

    it('refuses more speakers than the variant takes, before the worker is asked', async () => {
        const builder = await start();
        const response = await dialogue(builder, 'tone', { turns: [...TURNS, { speaker: 'c', text: 'May I come in?' }] });

        expect(response.statusCode).toBe(422);
        expect(response.json().error).toMatchObject({ code: 'unsupported' });
        expect(response.json().error.message).toContain('3 speakers');
    }, 60_000);

    it('holds the whole conversation to one ceiling', async () => {
        const builder = await start();
        const half = 'x'.repeat(2100);
        const response = await dialogue(builder, 'tone', {
            turns: [
                { speaker: 'a', text: half },
                { speaker: 'b', text: half },
            ],
        });

        expect(response.statusCode).toBe(400);
        expect(response.json().error.message).toContain('4200 characters');
    }, 60_000);

    it('refuses a voice the engine does not have rather than substituting one', async () => {
        const builder = await start();
        const response = await dialogue(builder, 'tone', { turns: TURNS, voices: { a: 'nobody' }, stream: false });

        expect(response.statusCode).toBe(404);
        expect(response.json().error).toMatchObject({ code: 'unknown_voice' });
    }, 60_000);

    it('is unsupported on an engine whose variants do not declare it', async () => {
        const builder = await start('ok');
        const response = await dialogue(builder, 'failing', { turns: TURNS });

        expect(response.statusCode).toBe(422);
        expect(response.json().error).toMatchObject({ code: 'unsupported' });
        expect(response.json().error.message).toContain('does not speak dialogue');
    }, 60_000);
});
