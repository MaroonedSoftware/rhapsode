import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { Voice } from '@rhapsode/contract';

import { RhapsodeJsonLogger } from '../src/logging/rhapsode.logger.js';
import { MAX_VOICE_UPLOAD_BYTES } from '../src/registry/engine.detail.routes.js';
import { buildServer } from '../src/server.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

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

let running: Awaited<ReturnType<typeof buildServer>> | undefined;
let dir: string | undefined;

afterEach(async () => {
    await running?.app.close();
    running = undefined;
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
});

async function start() {
    dir = mkdtempSync(join(tmpdir(), 'rh-voices-'));
    running = await buildServer(
        {
            workers: { socketDir: join(dir, 's'), voiceDir: join(dir, 'voices'), startupTimeoutSeconds: 30 },
            engines: { tone: { venv: join(REPO, 'python/.venv') } },
        },
        new RhapsodeJsonLogger('error', () => {}),
    );
    await running.app.ready();
    return running.app;
}

const BOUNDARY = 'rhapsodetestboundary';

/** A clone request as a browser's FormData would send it. */
function upload(id: string, reference: Buffer) {
    const payload = Buffer.concat([
        Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="id"\r\n\r\n${id}\r\n`),
        Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="reference"; filename="clip.wav"\r\nContent-Type: audio/wav\r\n\r\n`),
        reference,
        Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
    ]);
    return { payload, headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` } };
}

describeWithSockets('voices through the core', () => {
    it('clones, lists, speaks, previews and deletes, and keeps the voice where it was told to', { timeout: 60_000 }, async () => {
        const app = await start();

        const created = await app.inject({ method: 'POST', url: '/engines/tone/voices', ...upload('narrator', Buffer.from('a reference clip')) });
        expect(created.statusCode).toBe(201);
        const voice = Voice.parse(created.json());
        expect(voice.id).toBe('narrator');
        // Rewritten, as every voice the core hands out is. A worker-scoped URL is a 404 from here.
        expect(voice.previewUrl).toBe('/engines/tone/voices/narrator/preview');
        expect(readdirSync(join(dir!, 'voices', 'tone'))).toEqual(['narrator.ref']);

        const listed = (await app.inject({ method: 'GET', url: '/engines/tone/voices' })).json();
        expect(listed.map((entry: Voice) => entry.id)).toContain('narrator');

        const spoken = await app.inject({
            method: 'POST',
            url: '/speak',
            headers: { 'content-type': 'application/json' },
            payload: { engine: 'tone', text: 'In a voice of its own.', voice: 'narrator', stream: false, format: 'wav' },
        });
        expect(spoken.statusCode).toBe(200);

        const preview = await app.inject({ method: 'GET', url: voice.previewUrl! });
        expect(preview.statusCode).toBe(200);
        expect(preview.headers['content-type']).toBe('audio/wav');

        expect((await app.inject({ method: 'DELETE', url: '/engines/tone/voices/narrator' })).statusCode).toBe(204);
        const gone = await app.inject({
            method: 'POST',
            url: '/speak',
            headers: { 'content-type': 'application/json' },
            payload: { engine: 'tone', text: 'Still here?', voice: 'narrator', stream: false },
        });
        expect(gone.json().error.code).toBe('unknown_voice');
    });

    it('passes the worker’s refusals through with their codes', { timeout: 60_000 }, async () => {
        const app = await start();

        const path = await app.inject({ method: 'POST', url: '/engines/tone/voices', ...upload('../../x', Buffer.from('clip')) });
        expect(path.statusCode).toBe(400);
        expect(path.json().error.message).toMatch(/is not a name/);

        const builtIn = await app.inject({ method: 'DELETE', url: '/engines/tone/voices/sine' });
        expect(builtIn.json().error.code).toBe('unsupported');

        const missing = await app.inject({ method: 'DELETE', url: '/engines/tone/voices/nobody' });
        expect(missing.json().error.code).toBe('unknown_voice');
    });

    it('takes a clip of several megabytes, over Fastify’s own 1 MiB default', { timeout: 60_000 }, async () => {
        const app = await start();
        const created = await app.inject({ method: 'POST', url: '/engines/tone/voices', ...upload('long_clip', Buffer.alloc(6 * 1024 * 1024, 7)) });
        expect(created.statusCode).toBe(201);
    });

    it('refuses an upload over the cap, whether it says so up front or not', { timeout: 60_000 }, async () => {
        const app = await start();
        const oversized = Buffer.alloc(MAX_VOICE_UPLOAD_BYTES + 1024, 1);

        const declared = await app.inject({ method: 'POST', url: '/engines/tone/voices', ...upload('big', oversized) });
        expect(declared.statusCode).toBe(400);
        expect(declared.json().error.message).toMatch(/limited to 25 MB/);
        expect(existsSync(join(dir!, 'voices', 'tone', 'big.ref'))).toBe(false);

        // Chunked, with no Content-Length at all. ServerKit's body gate refuses a body of unknown
        // length before any route runs, so there is no way round the declared-length check.
        const { payload, headers } = upload('big', oversized);
        const chunked = await app.inject({ method: 'POST', url: '/engines/tone/voices', headers, payload: Readable.from([payload]) });
        expect(chunked.json().error).toMatchObject({ code: 'bad_request', message: 'Length Required' });
        expect(existsSync(join(dir!, 'voices', 'tone', 'big.ref'))).toBe(false);
    });

    it('answers only this machine, like every route that writes on the box', async () => {
        const app = await start();
        const remote = { remoteAddress: '10.0.0.5' };

        expect((await app.inject({ method: 'POST', url: '/engines/tone/voices', ...upload('x', Buffer.from('c')), ...remote })).statusCode).toBe(403);
        expect((await app.inject({ method: 'DELETE', url: '/engines/tone/voices/x', ...remote })).statusCode).toBe(403);
        // Listing stays open, like speaking.
        expect((await app.inject({ method: 'GET', url: '/engines/tone/voices', ...remote })).statusCode).toBe(200);
    });
});
