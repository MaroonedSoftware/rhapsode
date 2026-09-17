import { pipeline } from 'node:stream/promises';

import type { FastifyPluginAsync } from 'fastify';

import type { Voice } from '@rhapsode/contract';

import { RhapsodeError } from '../errors/rhapsode.error.js';
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
