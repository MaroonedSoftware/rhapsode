import { pipeline } from 'node:stream/promises';

import type { FastifyReply, FastifyRequest } from 'fastify';
import { Logger } from '@maroonedsoftware/logger';

import { assertWithinCeiling, effectiveVariant, MIN_PLAUSIBLE_AUDIO_BYTES, performable, type Claims } from '@rhapsode/contract';

import { RhapsodeError } from '../errors/rhapsode.error.js';
import { EngineRegistry } from '../registry/engine.registry.js';
import { ResidencyManager } from '../residency/residency.manager.js';
import { DURATION_HEADER, type SpokenResponse } from '../workers/worker.client.js';
import { WorkerRegistry } from '../workers/worker.registry.js';
import { audioFloor, ShortAudioError } from './audio.floor.js';

const DEFAULT_MAX_CHARACTERS = 4096;

/** A native speak request, already read off whichever body it arrived in. § 6. */
export interface NativeSpeak {
    engine: string;
    text: string;
    voice?: string;
    variant?: string;
    format?: string;
    language?: string;
    delivery?: string;
    params?: Record<string, number>;
    seed?: number;
    stream: boolean;
}

export interface SpeakOptions {
    /**
     * Called once the effective variant is known and before anything is committed, so a caller can
     * refuse what that variant cannot do. A throw here is an ordinary error envelope.
     */
    refine?: (claims: Claims, variant: string) => void;
}

/**
 * Speak a native request through its engine and put the answer on `reply`, streamed or buffered as
 * the request asked.
 *
 * Both `/speak` and the OpenAI shim end here, which is what keeps § 11's promise that the shim is a
 * translation and not a second implementation: there is one ceiling, one cue stripper, one lease and
 * one way of failing after the headers, and a rule added to any of them reaches both routes.
 *
 * The order below is load-bearing. Everything that can fail before the hijack fails as an ordinary
 * error envelope, and a buffered answer never reaches the hijack; everything after it is an aborted
 * connection, because once a 200 and a Content-Type are on the wire the status cannot be taken back.
 * That is the whole of § 6's "failing after the headers have gone", expressed as one line in a
 * handler.
 */
export async function speakThrough(
    request: FastifyRequest,
    reply: FastifyReply,
    native: NativeSpeak,
    options: SpeakOptions = {},
): Promise<FastifyReply> {
    const engines = request.container.get(EngineRegistry);
    const workers = request.container.get(WorkerRegistry);
    const residency = request.container.get(ResidencyManager);
    // Resolved before streaming, because ServerKit disposes the request scope when reply.raw
    // closes, not on onResponse. A container.get() inside a stream callback throws.
    const logger = request.container.get(Logger);

    const engineId = native.engine;
    if (!engines.has(engineId)) throw RhapsodeError.unknownEngine(engineId, engines.ids());
    if (native.text.length === 0) throw new RhapsodeError('bad_request', '`text` is required and must be a non-empty string');

    // Bringing the process up is cheap and tells us what this engine can do. Loading a model is
    // not, and happens under the residency lease below.
    const client = await workers.client(engineId);
    const capabilities = await client.capabilities();

    const variant = effectiveVariant(native.variant, capabilities.variants, {
        loaded: capabilities.current?.variant,
        fallback: engines.entry(engineId)?.defaultVariant,
    });
    const claims = capabilities.variants[variant] as Claims;

    options.refine?.(claims, variant);
    assertWithinCeiling(native.text, claims, DEFAULT_MAX_CHARACTERS);
    const ready = performable({ text: native.text, delivery: native.delivery, params: native.params }, claims, variant);

    if (ready.dropped.cues.length > 0 || ready.dropped.delivery !== undefined) {
        logger.debug('made the request performable', {
            engine: engineId,
            variant,
            droppedCues: ready.dropped.cues,
            droppedDelivery: ready.dropped.delivery,
        });
    }

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
                format: native.format,
                language: native.language,
                voice: native.voice,
                delivery: ready.delivery,
                params: ready.params,
                seed: native.seed,
                stream: native.stream,
            },
            clientGone.signal,
        );
    } catch (error) {
        settled = true;
        lease.release();
        throw error;
    }

    if (!native.stream) {
        try {
            return await sendBuffered(reply, upstream);
        } finally {
            settled = true;
            lease.release();
        }
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
        // end: false, because trailers go out with the terminating chunk and addTrailers after an
        // end() writes nothing. Left to pipeline, raw ended as the body did, and every duration a
        // worker sent was dropped here without an error.
        await pipeline(upstream.body, audioFloor(), raw, { end: false });
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
}

/**
 * `stream: false`: the whole body, counted, before any status is written.
 *
 * § 6 promises that a buffered request reports failures strictly better than a streamed one, because
 * every failure is still a pre-headers failure. That holds only if the core has the body before it
 * commits a status. It used to write the 200 first and count through the same floor a stream uses,
 * so a worker that answered a buffered request with a click still produced an aborted connection,
 * and the Content-Length and duration the worker had sent were dropped on the way through.
 *
 * The buffer is one response, bounded by the variant's `maxCharacters`, and § 13.2 is the decision
 * that the core holds audio here and nowhere else.
 */
async function sendBuffered(reply: FastifyReply, upstream: SpokenResponse): Promise<FastifyReply> {
    const chunks: Buffer[] = [];
    try {
        for await (const chunk of upstream.body) chunks.push(chunk as Buffer);
    } catch (error) {
        throw new RhapsodeError('internal', `the worker's answer ended early: ${error instanceof Error ? error.message : String(error)}`, {
            cause: error,
        });
    }

    const body = Buffer.concat(chunks);
    if (body.length < MIN_PLAUSIBLE_AUDIO_BYTES) {
        const short = new ShortAudioError(body.length);
        throw new RhapsodeError('internal', short.message, { cause: short });
    }

    reply.header('content-type', upstream.contentType).header('cache-control', 'no-store').header('content-length', body.length);
    if (upstream.durationMs !== undefined) reply.header(DURATION_HEADER, upstream.durationMs);
    return reply.send(body);
}
