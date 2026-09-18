import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import type { FastifyPluginAsync } from 'fastify';

import type { Voice } from '@rhapsode/contract';

import { RhapsodeError } from '../errors/rhapsode.error.js';
import { managementGuard } from '../management/management.module.js';
import { EngineRegistry } from './engine.registry.js';
import { WorkerRegistry } from '../workers/worker.registry.js';
import { audioFloor } from '../speak/audio.floor.js';

/**
 * The per-engine reads, proxied to the worker that owns the answer.
 *
 * These bring the worker *process* up on demand, which costs tens of megabytes and is fine. They do
 * not load a model, which costs gigabytes and is not: § 3 keeps those two apart precisely so that
 * asking what an engine can do does not cost a cold start.
 */
export const engineDetailRoutes: FastifyPluginAsync = async app => {
    app.get<{ Params: { engine: string } }>('/engines/:engine/capabilities', async request => {
        const client = await clientFor(request);
        return client.capabilities();
    });

    app.get<{ Params: { engine: string } }>('/engines/:engine/voices', async request => {
        const client = await clientFor(request);
        const voices = await client.voices();
        return voices.map(voice => rewritePreview(voice, request.params.engine));
    });

    /**
     * A clone. § 7.
     *
     * Behind the management guard, because it writes a file on the box. The upload goes to the
     * worker as it arrives, through a counter that breaks it off at the cap, so the core holds none
     * of it and a caller cannot make it hold more. No residency lease: an adapter's `create_voice`
     * stores the clip and loads nothing, which is the spec's rule, so nothing here can evict.
     */
    app.post<{ Params: { engine: string } }>(
        '/engines/:engine/voices',
        {
            onRequest: managementGuard,
            config: { body: ['multipart/form-data'] },
            // Fastify's default is 1 MiB, which ServerKit's parser checks against a declared length,
            // and a 20-second clip at 48 kHz is several MB. The cap below is the one that applies.
            bodyLimit: Number.MAX_SAFE_INTEGER,
        },
        async (request, reply) => {
            const declared = Number(request.headers['content-length']);
            if (Number.isFinite(declared) && declared > MAX_VOICE_UPLOAD_BYTES) throw tooLarge();

            const client = await clientFor(request);
            const counted = request.raw.pipe(capped(MAX_VOICE_UPLOAD_BYTES));
            request.raw.on('error', error => counted.destroy(error));
            const voice = await client.createVoice(counted, String(request.headers['content-type']), AbortSignal.timeout(PREVIEW_TIMEOUT_MS));
            return reply.status(201).send(rewritePreview(voice, request.params.engine));
        },
    );

    app.delete<{ Params: { engine: string; voice: string } }>(
        '/engines/:engine/voices/:voice',
        { onRequest: managementGuard },
        async (request, reply) => {
            const client = await clientFor(request);
            await client.deleteVoice(request.params.voice);
            return reply.status(204).send();
        },
    );

    /**
     * The other half of rewriting `previewUrl`.
     *
     * A URL the core hands out and then does not serve is worse than no URL at all, because a
     * client that follows it gets a 404 it cannot distinguish from a deleted voice.
     */
    app.get<{ Params: { engine: string; voice: string } }>('/engines/:engine/voices/:voice/preview', async (request, reply) => {
        const client = await clientFor(request);
        const upstream = await client.preview(request.params.voice, AbortSignal.timeout(PREVIEW_TIMEOUT_MS));

        reply.hijack();
        const raw = reply.raw;
        raw.writeHead(200, { 'content-type': upstream.contentType, 'cache-control': 'no-store' });

        try {
            await pipeline(upstream.body, audioFloor(), raw);
            raw.end();
        } catch {
            // Same rule as /speak: the status is spent, so the only honest ending is a break.
            if (!raw.destroyed) raw.destroy();
        }
        return reply;
    });
};

/**
 * The largest clone upload the core passes on. § 7: a usable reference is 5 to 20 seconds, under
 * 6 MB even as 48 kHz stereo at 24 bits, so this is generous for any clip and small enough that one
 * request cannot fill a disk.
 */
export const MAX_VOICE_UPLOAD_BYTES = 25 * 1024 * 1024;

const tooLarge = () => new RhapsodeError('bad_request', `a voice upload is limited to ${MAX_VOICE_UPLOAD_BYTES / 1024 / 1024} MB`);

/**
 * Passes bytes through until there have been too many, then fails.
 *
 * The declared Content-Length is the cap that does the work: ServerKit's body gate refuses a body
 * with no length (411) before any route runs, and Node's parser holds a body to the length it
 * declared. This is the backstop that makes the cap true of the bytes that actually go to the worker
 * rather than of a header, for the price of a counter.
 */
function capped(limit: number): Transform {
    let seen = 0;
    return new Transform({
        transform(chunk: Buffer, _encoding, done) {
            seen += chunk.length;
            if (seen > limit) done(tooLarge());
            else done(undefined, chunk);
        },
    });
}

/** A preview is one short fixed line, so it has no business taking as long as a synthesis. */
const PREVIEW_TIMEOUT_MS = 120_000;

async function clientFor(request: { params: { engine: string }; container: { get: <T>(t: new (...a: never[]) => T) => T } }) {
    const engines = request.container.get(EngineRegistry);
    if (!engines.has(request.params.engine)) {
        throw RhapsodeError.unknownEngine(request.params.engine, engines.ids());
    }
    return request.container.get(WorkerRegistry).client(request.params.engine);
}

/**
 * The one field the core edits while proxying, and the only reason it does is that the worker
 * cannot know its own prefix.
 *
 * A worker answers `/voices/{id}/preview`, which is right on its own socket and a 404 to anybody who
 * followed it from the public API.
 */
export function rewritePreview(voice: Voice, engine: string): Voice {
    if (voice.previewUrl === undefined) return voice;
    return { ...voice, previewUrl: `/engines/${engine}/voices/${voice.id}/preview` };
}
