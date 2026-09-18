import { pipeline } from 'node:stream/promises';

import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { Logger } from '@maroonedsoftware/logger';

import { assertWithinCeiling, effectiveVariant, performable, type Claims } from '@rhapsode/contract';

import { RhapsodeError } from '../errors/rhapsode.error.js';
import { EngineRegistry } from '../registry/engine.registry.js';
import { ResidencyManager } from '../residency/residency.manager.js';
import { WorkerRegistry } from '../workers/worker.registry.js';
import { audioFloor } from './audio.floor.js';

const DEFAULT_MAX_CHARACTERS = 4096;

/**
 * `POST /speak`. The one endpoint that matters, and the one ContractKit cannot express.
 *
 * The order below is load-bearing. Everything that can fail before the hijack fails as an ordinary
 * error envelope; everything after it is an aborted connection, because once a 200 and a
 * Content-Type are on the wire the status cannot be taken back. That is the whole of § 6's "failing
 * after the headers have gone", expressed as one line in a handler.
 */
export const speakRoutes: FastifyPluginAsync = async app => {
    app.post('/speak', { config: { body: ['application/json'] } }, async (request, reply) => {
        const engines = request.container.get(EngineRegistry);
        const workers = request.container.get(WorkerRegistry);
        const residency = request.container.get(ResidencyManager);
        // Resolved before streaming, because ServerKit disposes the request scope when reply.raw
        // closes, not on onResponse. A container.get() inside a stream callback throws.
        const logger = request.container.get(Logger);

        const body = (request.body ?? {}) as Record<string, unknown>;
        const engineId = typeof body.engine === 'string' ? body.engine : undefined;
        if (engineId === undefined) throw new RhapsodeError('bad_request', '`engine` is required');
        if (!engines.has(engineId)) throw RhapsodeError.unknownEngine(engineId, engines.ids());

        const text = typeof body.text === 'string' ? body.text : '';
        if (text.length === 0) throw new RhapsodeError('bad_request', '`text` is required and must be a non-empty string');

        // Bringing the process up is cheap and tells us what this engine can do. Loading a model is
        // not, and happens under the residency lease below.
        const client = await workers.client(engineId);
        const capabilities = await client.capabilities();

        const variant = effectiveVariant(typeof body.variant === 'string' ? body.variant : undefined, capabilities.variants, {
            loaded: capabilities.current?.variant,
            fallback: engines.entry(engineId)?.defaultVariant,
        });
        const claims = capabilities.variants[variant] as Claims;

        assertWithinCeiling(text, claims, DEFAULT_MAX_CHARACTERS);
        const ready = performable(
            {
                text,
                delivery: typeof body.delivery === 'string' ? body.delivery : undefined,
                params: body.params as Record<string, number> | undefined,
            },
            claims,
            variant,
        );

        if (ready.dropped.cues.length > 0 || ready.dropped.delivery !== undefined) {
            logger.debug('made the request performable', {
                engine: engineId,
                variant,
                droppedCues: ready.dropped.cues,
                droppedDelivery: ready.dropped.delivery,
            });
        }

        const wants = body.stream !== false;
        const lease = await residency.acquire(engineId, variant);

        // One controller for both ways a synthesis should stop early: the client going away, and
        // the server shutting down.
        const clientGone = new AbortController();
        let settled = false;
        request.raw.on('close', () => {
            if (!settled) clientGone.abort();
        });

        let upstream;
        try {
            upstream = await client.speak(
                {
                    text: ready.text,
                    variant,
                    format: typeof body.format === 'string' ? body.format : undefined,
                    voice: typeof body.voice === 'string' ? body.voice : undefined,
                    delivery: ready.delivery,
                    params: ready.params,
                    seed: typeof body.seed === 'number' ? body.seed : undefined,
                    stream: wants,
                },
                clientGone.signal,
            );
        } catch (error) {
            settled = true;
            lease.release();
            throw error;
        }

        // Only now. Everything above could still answer with a status.
        reply.hijack();

        const raw = reply.raw;
        raw.writeHead(200, {
            // The worker's, verbatim. § 6 says the response's Content-Type is authoritative, which
            // operationally means the core holds no format table: the same rule as "never imports
            // torch" applied to metadata.
            'content-type': upstream.contentType,
            'cache-control': 'no-store',
            ...(upstream.trailer === undefined ? {} : { trailer: upstream.trailer }),
        });

        try {
            await pipeline(upstream.body, audioFloor(), raw);
            const trailers = upstream.trailers();
            if (upstream.trailer !== undefined && Object.keys(trailers).length > 0) {
                raw.addTrailers(trailers as Record<string, string>);
            }
            raw.end();
        } catch (error) {
            // Never end() here. end() writes the terminating chunk and the client reads a clean,
            // short, silent file, which is precisely the bug § 6 exists to prevent. pipeline has
            // already destroyed the destination; this is for the paths where it has not.
            if (!raw.destroyed) raw.destroy();
            logger.error('speak failed after the headers went out', { engine: engineId, variant, error });
        } finally {
            settled = true;
            lease.release();
        }

        return reply;
    });
};

/** Exported for the shims, which need the same rules and not the same route. */
export type SpeakReply = FastifyReply;
