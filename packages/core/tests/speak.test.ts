import { mkdtempSync, rmSync } from 'node:fs';
import { request, type IncomingHttpHeaders } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DateTime } from 'luxon';
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

const speak = (builder: Awaited<ReturnType<typeof buildServer>>, payload: Record<string, unknown>) =>
    builder.app.inject({ method: 'POST', url: '/speak', payload, headers: { 'content-type': 'application/json' } });

describe('refusals that happen before anything is committed', () => {
    it('refuses an engine it was never told about', async () => {
        const builder = await start();
        const response = await speak(builder, { engine: 'chatterbox', text: 'x' });

        expect(response.statusCode).toBe(404);
        expect(response.json().error).toMatchObject({ code: 'unknown_engine', retryable: false });
    });

    it('refuses an empty text without spawning anything', async () => {
        const builder = await start();
        expect((await speak(builder, { engine: 'tone', text: '' })).statusCode).toBe(400);
    });

    it('requires an engine', async () => {
        const builder = await start();
        expect((await speak(builder, { text: 'x' })).statusCode).toBe(400);
    });

    it('refuses a keep-alive that is not a whole number of seconds, or is below never', async () => {
        // -1 is as low as it goes, and -2 would read as "never expire" to anything testing for a
        // negative. A caller who fumbled the number gets told, rather than a model kept for good.
        const builder = await start();

        for (const keepAliveSeconds of [-2, 1.5, '5m', null]) {
            const response = await speak(builder, { engine: 'tone', text: 'x', keepAliveSeconds });
            expect(response.statusCode).toBe(400);
            expect(response.json().error.message).toContain('keepAliveSeconds');
        }
    });

    it('takes a keep-alive of -1, 0 and a duration', async () => {
        // Against an engine that does not exist, so this asks whether the value got past validation
        // and nothing else: a 404 means it did. What the value then does is the residency manager's,
        // and is tested there without a worker either.
        const builder = await start();

        for (const keepAliveSeconds of [-1, 0, 30]) {
            const response = await speak(builder, { engine: 'nope', text: 'x', keepAliveSeconds });
            expect(response.json().error).toMatchObject({ code: 'unknown_engine' });
        }
    });

    it('refuses a misspelled field and names it, rather than ignoring what the client meant', async () => {
        // `streaming` is not `stream`. Ignored, the caller gets a stream it believes it turned off,
        // which is the silent discard § 6 spends a section arguing against.
        const builder = await start();
        const response = await speak(builder, { engine: 'tone', text: 'x', streaming: false });

        expect(response.statusCode).toBe(400);
        expect(response.json().error).toMatchObject({ code: 'bad_request', retryable: false });
        expect(response.json().error.message).toContain('"streaming"');
    });
});

describeWithSockets('speaking', () => {
    it('streams chunked, with the worker’s own Content-Type', async () => {
        // Section 6: the response's Content-Type is authoritative, which operationally means the
        // core holds no format table. The same rule as "never imports torch", applied to metadata.
        const builder = await start();
        const response = await speak(builder, { engine: 'tone', text: 'a line to speak', format: 'pcm', stream: true });

        expect(response.statusCode).toBe(200);
        expect(response.headers['content-type']).toBe('audio/L16; rate=24000; channels=1');
        expect(response.rawPayload.length).toBeGreaterThan(256);
    }, 60_000);

    it('buffers when asked to, and the WAV header carries the real sizes', async () => {
        const builder = await start();
        const response = await speak(builder, { engine: 'tone', text: 'buffered', format: 'wav', stream: false });

        expect(response.statusCode).toBe(200);
        const body = response.rawPayload;
        expect(body.subarray(0, 4).toString()).toBe('RIFF');
        expect(body.readUInt32LE(40)).toBe(body.length - 44);
    }, 60_000);

    it('says how long a buffered take is, in bytes and in time', async () => {
        // § 6: with `stream: false` both are known before the headers go out, so both are headers.
        // The worker sent them and the core dropped them, forwarding only the Content-Type.
        const builder = await start();
        const response = await speak(builder, { engine: 'tone', text: 'buffered', format: 'pcm', stream: false });

        expect(response.statusCode).toBe(200);
        expect(Number(response.headers['content-length'])).toBe(response.rawPayload.length);
        expect(response.headers['transfer-encoding']).toBeUndefined();
        // Tone's pcm is s16le at 24 kHz mono, so the body is the samples and nothing else.
        expect(Number(response.headers['x-rhapsode-duration-ms'])).toBe(Math.round((response.rawPayload.length / 2 / 24_000) * 1000));
    }, 60_000);

    it('ends a streamed take with its duration in a trailer', async () => {
        // § 6: with `stream: true` the duration is known only once the audio has finished, so it is
        // a trailer. Over a real socket, because inject() has no trailers, and with node:http
        // rather than fetch, because fetch has no trailer API at all.
        const builder = await start();
        const address = await builder.app.listen({ port: 0, host: '127.0.0.1' });

        const { headers, audio, trailers } = await new Promise<{
            headers: IncomingHttpHeaders;
            audio: Buffer;
            trailers: NodeJS.Dict<string>;
        }>((fulfil, fail) => {
            const outgoing = request(
                `${address}/speak`,
                { method: 'POST', headers: { 'content-type': 'application/json', te: 'trailers' } },
                response => {
                    const chunks: Buffer[] = [];
                    response.on('data', (chunk: Buffer) => chunks.push(chunk));
                    response.on('end', () => fulfil({ headers: response.headers, audio: Buffer.concat(chunks), trailers: response.trailers }));
                    response.on('error', fail);
                },
            );
            outgoing.on('error', fail);
            outgoing.end(JSON.stringify({ engine: 'tone', text: 'a streamed line', format: 'pcm', stream: true }));
        });

        expect(headers.trailer?.toLowerCase()).toBe('x-rhapsode-duration-ms');
        // Tone's pcm is s16le at 24 kHz mono, so the body is the samples and nothing else.
        expect(Number(trailers['x-rhapsode-duration-ms'])).toBe(Math.round((audio.length / 2 / 24_000) * 1000));
    }, 60_000);

    it('strips a cue the variant does not claim, before the worker ever sees it', async () => {
        // An engine that performs no cues never receives one, so the failure where an engine reads
        // the word "laugh" out loud cannot happen. Shorter text is shorter audio, which is how the
        // tone engine makes that visible.
        const builder = await start();
        const kept = await speak(builder, { engine: 'tone', text: 'a [laugh] line', variant: 'plain', format: 'pcm', stream: false });
        const stripped = await speak(builder, { engine: 'tone', text: 'a [groan] line', variant: 'plain', format: 'pcm', stream: false });

        expect(stripped.rawPayload.length).toBeLessThan(kept.rawPayload.length);
    }, 60_000);

    it('refuses an unknown dial and names it', async () => {
        const builder = await start();
        const response = await speak(builder, { engine: 'tone', text: 'x', variant: 'dialled', params: { nope: 1 } });

        expect(response.statusCode).toBe(400);
        expect(response.json().error.message).toContain('"nope"');
        expect(response.json().error.message).toContain('pitch');
    }, 60_000);

    it('hands the worker the language, so one the variant does not speak is refused', async () => {
        // § 6: a multilingual variant reads `language`. Before this reached the worker, every
        // request spoke the variant's first language whatever it asked for. Tone speaks only "en",
        // and the refusal is the worker's own, which is the evidence the field arrived.
        const builder = await start();
        const refused = await speak(builder, { engine: 'tone', text: 'x', language: 'fr', format: 'pcm', stream: false });

        expect(refused.statusCode).toBe(422);
        expect(refused.json().error).toMatchObject({ code: 'unsupported' });
        expect(refused.json().error.message).toContain('"fr"');

        const spoken = await speak(builder, { engine: 'tone', text: 'x', language: 'en', format: 'pcm', stream: false });
        expect(spoken.statusCode).toBe(200);
    }, 60_000);

    it('refuses a variant the engine does not have rather than swapping one in', async () => {
        const builder = await start();
        expect((await speak(builder, { engine: 'tone', text: 'x', variant: 'nosuch' })).statusCode).toBe(422);
    }, 60_000);

    it('holds a model resident and reports it', async () => {
        const builder = await start();
        await speak(builder, { engine: 'tone', text: 'x', stream: false });

        const health = (await builder.app.inject({ method: 'GET', url: '/health' })).json();
        expect(health.engines[0]).toMatchObject({ model: 'loaded', variant: 'plain' });
        expect(health.residency).toMatchObject({ resident: 1, max: 1 });
    }, 60_000);
});

describeWithSockets('failing after the headers have gone', () => {
    /**
     * These go over a real socket rather than through inject().
     *
     * An aborted connection is the thing being tested, and inject() is an in-process simulation
     * that surfaces a destroyed stream as a rejected promise. What matters is what a client on the
     * other end of a TCP connection observes, and only a TCP connection can answer that.
     *
     * app.listen rather than builder.start, because ServerKit's graceful shutdown calls
     * process.exit, which in a test runner takes the runner with it.
     */
    async function listening(mode: string): Promise<string> {
        const builder = await start(mode);
        const address = await builder.app.listen({ port: 0, host: '127.0.0.1' });
        return address;
    }

    async function readToEnd(url: string, payload: Record<string, unknown>) {
        const response = await fetch(`${url}/speak`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
        });

        let bytes = 0;
        let failure: unknown;
        try {
            for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) bytes += chunk.length;
        } catch (error) {
            failure = error;
        }
        return { status: response.status, contentType: response.headers.get('content-type'), bytes, failure, response };
    }

    it('aborts rather than ending cleanly when the worker dies mid-stream', async () => {
        // Once a 200 and a Content-Type are on the wire the status cannot be taken back. A clean
        // close would hand the client a short successful body, which is a segment that airs as a
        // click and is noticed by nobody. A passing read with no error here IS the bug.
        const url = await listening('raise_mid_stream');
        const result = await readToEnd(url, { engine: 'failing', text: 'x', format: 'pcm', stream: true });

        expect(result.status).toBe(200);
        expect(result.bytes).toBeGreaterThan(0);
        expect(result.failure).toBeInstanceOf(TypeError);
        expect(String(result.failure)).toContain('terminated');
    }, 60_000);

    it('refuses a body too small to be audio, at the end of the stream', async () => {
        // A worker answering 200 with a JSON complaint produces a segment that airs as a click, and
        // the only place to notice is at the end. The client cannot be told why, because the status
        // is long gone; it can only be told that this is not a whole response.
        const url = await listening('tiny');
        const result = await readToEnd(url, { engine: 'failing', text: 'x', format: 'pcm', stream: true });

        expect(result.status).toBe(200);
        expect(result.bytes).toBeLessThan(256);
        expect(result.failure).toBeInstanceOf(TypeError);
    }, 60_000);

    it('reports a body too small to be audio as an envelope when it was buffered', async () => {
        // § 6: "stream: false reports failures strictly better than stream: true does". The core
        // used to write its 200 before counting, so a buffered request that was sent a click got an
        // aborted connection exactly as a streamed one did, and no reason.
        const builder = await start('tiny');
        const response = await speak(builder, { engine: 'failing', text: 'x', format: 'pcm', stream: false });

        expect(response.statusCode).toBe(500);
        expect(response.json().error).toMatchObject({ code: 'internal', retryable: false });
        expect(response.json().error.message).toContain('16 bytes');
    }, 60_000);

    it('reports a pre-headers failure as a clean envelope instead', async () => {
        // Priming is what buys this: a failure before the first byte is still a status, so the
        // abort path stays rare and the taxonomy stays useful.
        const builder = await start('raise_before_any_audio');
        const response = await speak(builder, { engine: 'failing', text: 'x', format: 'pcm', stream: true });

        expect(response.statusCode).toBe(500);
        expect(response.json().error).toMatchObject({ code: 'internal', retryable: false });
    }, 60_000);

    it('reports an OOM during the on-demand load as retryable', async () => {
        const builder = await start('load_oom');
        const response = await speak(builder, { engine: 'failing', text: 'x', stream: false });

        expect(response.statusCode).toBe(503);
        expect(response.json().error).toMatchObject({ code: 'oom', retryable: true });
    }, 60_000);
});

describeWithSockets('version skew', () => {
    it('refuses a worker whose contract major is above its own, naming both', async () => {
        // The core and its workers ship separately, so they will disagree in the field. Designing
        // for that on day one costs about forty lines; retrofitting it costs a client that sniffs
        // your OpenAPI document to work out what you accept.
        socketDir = mkdtempSync(join(tmpdir(), 'rh-'));
        const builder = await buildServer(
            {
                workers: { socketDir, startupTimeoutSeconds: 30 },
                engines: {
                    future: {
                        displayName: 'From the future',
                        license: MIT,
                        command: PYTHON,
                        args: ['-m', 'engines.future'],
                        cwd: REPO,
                        env: { PYTHONPATH: WORKER_TESTS },
                    },
                },
            },
            new RhapsodeJsonLogger('error', () => {}),
        );
        running = builder;
        await builder.app.ready();

        const response = await builder.app.inject({ method: 'GET', url: '/engines/future/capabilities' });

        expect(response.statusCode).toBe(422);
        const message = response.json().error.message;
        expect(message).toContain('99');
        expect(message).toContain('1');
    }, 60_000);
});

describeWithSockets('residency under contention', () => {
    /**
     * Two engines and one slot, which is the only way to make the core evict on purpose.
     *
     * The second is a genuinely different engine rather than the tone engine under another name: a
     * worker refuses to start when the core spawned an id it does not answer to, so a second engine
     * has to be a second engine.
     */
    const startTwo = async () => {
        socketDir = mkdtempSync(join(tmpdir(), 'rh-'));
        const builder = await buildServer(
            {
                workers: { socketDir, startupTimeoutSeconds: 30 },
                residency: { maxResidentModels: 1, evictionWaitSeconds: 30 },
                engines: {
                    tone: { venv: join(REPO, 'python/.venv') },
                    noisy: { displayName: 'Noisy', license: MIT, command: PYTHON, args: ['-m', 'engines.noisy'], cwd: WORKER_TESTS },
                },
            },
            new RhapsodeJsonLogger('error', () => {}),
        );
        running = builder;
        await builder.app.ready();
        return builder;
    };

    type Listed = { resident: number; max: number; models: { engine: string; leases: number; keepAliveSeconds: number; expiresAt: string }[] };
    const residencyOf = (response: { json: () => unknown }) => response.json() as Listed;

    const engineState = async (builder: Awaited<ReturnType<typeof buildServer>>, id: string) =>
        (await builder.app.inject({ method: 'GET', url: '/engines' })).json().find((engine: { id: string }) => engine.id === id);

    it('queues a second engine rather than evicting a model that is speaking', async () => {
        // At maxResidentModels 1 this is simply a queue, and it will look like a hang to an
        // operator, which is why /health names what is blocking.
        const builder = await startTwo();

        await speak(builder, { engine: 'tone', text: 'first', stream: false });
        const health = (await builder.app.inject({ method: 'GET', url: '/health' })).json();

        // One resident, and the budget is honest about the ceiling.
        expect(health.residency).toMatchObject({ resident: 1, max: 1 });
    }, 60_000);

    it('lists what a speak left on the card', async () => {
        const builder = await startTwo();
        expect(residencyOf(await builder.app.inject({ method: 'GET', url: '/residency' })).models).toEqual([]);

        await speak(builder, { engine: 'tone', text: 'first', stream: false, keepAliveSeconds: 900 });
        const residency = residencyOf(await builder.app.inject({ method: 'GET', url: '/residency' }));

        expect(residency).toMatchObject({ resident: 1, max: 1 });
        expect(residency.models).toHaveLength(1);
        expect(residency.models[0]).toMatchObject({ engine: 'tone', leases: 0, keepAliveSeconds: 900 });
        // The request said 900, so the deadline is fifteen minutes out rather than five.
        const expiresIn = DateTime.fromISO(residency.models[0].expiresAt).diffNow().as('seconds');
        expect(expiresIn).toBeGreaterThan(600);
    }, 60_000);

    it('frees a real model on request, and the engine still speaks afterwards', async () => {
        const builder = await startTwo();
        await speak(builder, { engine: 'tone', text: 'first', stream: false, keepAliveSeconds: -1 });

        const unloaded = await builder.app.inject({ method: 'POST', url: '/engines/tone/unload' });

        expect(unloaded.statusCode).toBe(200);
        expect(unloaded.json()).toMatchObject({ id: 'tone', model: 'unloaded', restarts: 0 });
        expect(residencyOf(await builder.app.inject({ method: 'GET', url: '/residency' })).models).toEqual([]);

        expect((await speak(builder, { engine: 'tone', text: 'again', stream: false })).statusCode).toBe(200);
        expect(await engineState(builder, 'tone')).toMatchObject({ model: 'loaded', restarts: 0 });
    }, 90_000);

    it('evicts the idle one by the verb, and does not count its exit as a crash', async () => {
        // An exit that follows `/terminate` is not a crash however it is timed (§ 2). Counted as
        // one, an engine evicted often enough would open its own circuit breaker and stop coming
        // back, which is exactly what idle freeing would make routine.
        const builder = await startTwo();

        expect((await speak(builder, { engine: 'tone', text: 'first', stream: false })).statusCode).toBe(200);
        expect((await speak(builder, { engine: 'noisy', text: 'second', stream: false })).statusCode).toBe(200);

        expect(await engineState(builder, 'tone')).toMatchObject({ process: 'down', model: 'unloaded', restarts: 0 });
        expect(await engineState(builder, 'noisy')).toMatchObject({ model: 'loaded' });

        // And the evicted engine still works, which is the whole point of reclaiming it cleanly.
        expect((await speak(builder, { engine: 'tone', text: 'again', stream: false })).statusCode).toBe(200);
        expect(await engineState(builder, 'tone')).toMatchObject({ model: 'loaded', restarts: 0 });
    }, 90_000);
});
