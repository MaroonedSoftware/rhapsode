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

/** The tone engine, or a misbehaving one chosen by mode. */
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

const speech = (builder: Awaited<ReturnType<typeof buildServer>>, payload: unknown, headers: Record<string, string> = {}) =>
    builder.app.inject({
        method: 'POST',
        url: '/v1/audio/speech',
        payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
        headers: { 'content-type': 'application/json', ...headers },
    });

describe('refusals the shim makes before anything is committed', () => {
    it('refuses a field OpenAI does not have, naming it, as OpenAI does', async () => {
        const builder = await start();
        const response = await speech(builder, { model: 'tone', input: 'x', seed: 7 });

        expect(response.statusCode).toBe(400);
        expect(response.headers['x-should-retry']).toBe('false');
        expect(response.json().error).toMatchObject({ type: 'invalid_request_error', param: 'seed', code: 'bad_request', retryable: false });
        expect(response.json().error.message).toContain('"seed"');
    });

    it('refuses tts-1 rather than substituting an engine, and names the ones there are', async () => {
        // § 11: a substitute is audio nobody asked for, delivered with a 200.
        const builder = await start();
        const response = await speech(builder, { model: 'tts-1', input: 'x', voice: 'alloy' });

        expect(response.statusCode).toBe(404);
        expect(response.json().error).toMatchObject({ param: 'model', code: 'unknown_engine' });
        expect(response.json().error.message).toContain('tone');
    });

    it.each([
        [{ response_format: 'aac' }, 'response_format'],
        [{ stream_format: 'sse' }, 'stream_format'],
        [{ instructions: 'speak like a pirate' }, 'instructions'],
    ])('refuses %o as unsupported rather than dropping it', async (extra, param) => {
        const builder = await start();
        const response = await speech(builder, { model: 'tone', input: 'x', ...extra });

        expect(response.statusCode).toBe(422);
        expect(response.json().error).toMatchObject({ type: 'invalid_request_error', param, code: 'unsupported' });
    });

    it('answers a body that is not JSON in its own envelope, not the core’s', async () => {
        // The error handler is on the route, so a refusal from the body parser is OpenAI-shaped too.
        const builder = await start();
        const response = await speech(builder, '{"model": ');

        expect(response.statusCode).toBe(400);
        expect(response.json().error).toMatchObject({ type: 'invalid_request_error', code: 'bad_request' });
        expect(response.headers['x-should-retry']).toBe('false');
    });

    it('ignores the API key every OpenAI client insists on sending', async () => {
        const builder = await start(undefined, { management: { token: 'the-real-management-token' } });
        const response = await speech(builder, { model: 'tts-1', input: 'x' }, { authorization: 'Bearer sk-anything' });

        // Refused for the model, which is to say that the key was not what anybody looked at.
        expect(response.json().error.code).toBe('unknown_engine');
    });
});

describeWithSockets('speaking through the shim', () => {
    it('streams the engine’s audio with the worker’s own Content-Type', async () => {
        const builder = await start();
        const response = await speech(builder, { model: 'tone', input: 'a line to speak', voice: 'sine', response_format: 'pcm' });

        expect(response.statusCode).toBe(200);
        expect(response.headers['content-type']).toBe('audio/L16; rate=24000; channels=1');
        expect(response.rawPayload.length).toBeGreaterThan(256);
    }, 60_000);

    it('reads a variant out of engine:variant', async () => {
        const builder = await start();
        const response = await speech(builder, { model: 'tone:dialled', input: 'x', response_format: 'wav' });
        expect(response.statusCode).toBe(200);

        const health = (await builder.app.inject({ method: 'GET', url: '/health' })).json();
        expect(health.engines[0]).toMatchObject({ model: 'loaded', variant: 'dialled' });
    }, 60_000);

    it('refuses a variant the engine does not have', async () => {
        const builder = await start();
        const response = await speech(builder, { model: 'tone:nosuch', input: 'x', response_format: 'wav' });

        expect(response.statusCode).toBe(422);
        expect(response.json().error.code).toBe('unsupported');
    }, 60_000);

    it('refuses alloy as a voice the engine does not have', async () => {
        const builder = await start();
        const response = await speech(builder, { model: 'tone', input: 'x', voice: 'alloy', response_format: 'wav' });

        expect(response.statusCode).toBe(404);
        expect(response.json().error).toMatchObject({ param: 'voice', code: 'unknown_voice' });
    }, 60_000);

    it('takes a speed of 1 as nothing asked for, and refuses any other with no dial to carry it', async () => {
        const builder = await start();

        expect((await speech(builder, { model: 'tone', input: 'x', speed: 1, response_format: 'wav' })).statusCode).toBe(200);

        const refused = await speech(builder, { model: 'tone', input: 'x', speed: 1.5, response_format: 'wav' });
        expect(refused.statusCode).toBe(422);
        expect(refused.json().error).toMatchObject({ param: 'speed', code: 'unsupported' });
    }, 60_000);

    it('takes empty instructions as none', async () => {
        const builder = await start();
        expect((await speech(builder, { model: 'tone', input: 'x', instructions: '', response_format: 'wav' })).statusCode).toBe(200);
    }, 60_000);

    it('asks for mp3 when no format was named, and never falls back to another', async () => {
        // OpenAI's default. With an ffmpeg that has libmp3lame it is audio/mpeg; without one it is
        // unsupported, and never a WAV that a client saving speech.mp3 would not notice.
        const builder = await start();
        const response = await speech(builder, { model: 'tone', input: 'x' });

        if (response.statusCode === 200) {
            expect(response.headers['content-type']).toBe('audio/mpeg');
        } else {
            expect(response.statusCode).toBe(422);
            expect(response.json().error).toMatchObject({ code: 'unsupported', type: 'invalid_request_error' });
        }
    }, 60_000);
});

describeWithSockets('telling OpenAI’s SDKs what to retry', () => {
    it('says not to retry an internal failure, which the SDKs otherwise would twice', async () => {
        const builder = await start('raise_before_any_audio');
        const response = await speech(builder, { model: 'failing', input: 'x', response_format: 'pcm' });

        expect(response.statusCode).toBe(500);
        expect(response.headers['x-should-retry']).toBe('false');
        expect(response.json().error).toMatchObject({ type: 'server_error', code: 'internal', retryable: false });
    }, 60_000);

    it('says to retry an OOM during the load', async () => {
        const builder = await start('load_oom');
        const response = await speech(builder, { model: 'failing', input: 'x', response_format: 'pcm' });

        expect(response.statusCode).toBe(503);
        expect(response.headers['x-should-retry']).toBe('true');
        expect(response.json().error).toMatchObject({ type: 'server_error', code: 'oom', retryable: true });
    }, 60_000);
});
