import type { FastifyPluginAsync } from 'fastify';

import type { Voice } from '@rhapsode/contract';

import { RhapsodeError } from '../errors/rhapsode.error.js';
import { EngineRegistry } from './engine.registry.js';
import { WorkerRegistry } from '../workers/worker.registry.js';

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
};

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
