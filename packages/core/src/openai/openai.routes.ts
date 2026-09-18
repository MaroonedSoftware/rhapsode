import type { FastifyPluginAsync } from 'fastify';

import { OpenAISpeechRequest } from '@rhapsode/contract';

import { EngineRegistry } from '../registry/engine.registry.js';
import { speakThrough } from '../speak/speak.pipeline.js';
import { openaiErrorHandler, ShimRefusal } from './openai.error.js';

const FIELDS = Object.keys(OpenAISpeechRequest.shape).join(', ');

/**
 * `POST /v1/audio/speech`, OpenAI's speech route, translated into `/speak`. § 11.
 *
 * Everything here is translation: reading OpenAI's body, refusing what has no native equivalent,
 * and choosing the engine from `model`. What it means to speak is `speakThrough`, the same code
 * `/speak` runs, so no rule in § 6 is written twice and none can drift.
 */
export const openaiRoutes: FastifyPluginAsync = async app => {
    app.post('/v1/audio/speech', { config: { body: ['application/json'] }, errorHandler: openaiErrorHandler }, async (request, reply) => {
        const parsed = OpenAISpeechRequest.safeParse(request.body ?? {});
        if (!parsed.success) throw refusalFor(parsed.error.issues[0]);
        const body = parsed.data;

        if (body.response_format === 'aac') {
            throw new ShimRefusal('unsupported', 'no engine here encodes aac; ask for mp3, opus, flac, wav or pcm', 'response_format');
        }
        if (body.stream_format === 'sse') {
            throw new ShimRefusal('unsupported', 'audio arrives as the response body; stream_format "sse" is not served', 'stream_format');
        }
        if (body.instructions !== undefined && body.instructions.length > 0) {
            // Dropping it would answer 200 in a voice nobody directed, which is § 6's silent discard.
            throw new ShimRefusal(
                'unsupported',
                'free-text instructions have no equivalent here; POST /speak takes a delivery and the cues the engine claims',
                'instructions',
            );
        }

        const { engine, variant } = engineFor(body.model, request.container.get(EngineRegistry));
        // 1 is OpenAI's default, so a client that sends it has asked for nothing.
        const speed = body.speed === undefined || body.speed === 1 ? undefined : body.speed;

        return speakThrough(
            request,
            reply,
            {
                engine,
                variant,
                text: body.input,
                voice: body.voice,
                // OpenAI's default. Falling back to wav where ffmpeg is missing would hand a client
                // that saves the body as speech.mp3 a WAV it never checks the type of.
                format: body.response_format ?? 'mp3',
                params: speed === undefined ? undefined : { speed },
                stream: true,
            },
            {
                refine: (claims, name) => {
                    if (speed === undefined) return;
                    const dial = claims.dials.speed;
                    if (dial === undefined) {
                        throw new ShimRefusal('unsupported', `variant "${name}" has no speed dial, so only a speed of 1 can be honoured`, 'speed');
                    }
                    if (speed < dial.min || speed > dial.max) {
                        throw new ShimRefusal('bad_request', `speed is ${speed} and variant "${name}" takes ${dial.min} to ${dial.max}`, 'speed');
                    }
                },
            },
        );
    });
};

/**
 * `model` is an engine id, or `engine:variant` in Ollama's spelling. An exact id is tried first, so an
 * engine whose id has a colon in it is still reachable; anything else is left for `speakThrough` to
 * refuse as `unknown_engine`, naming the engines there are.
 */
function engineFor(model: string, engines: EngineRegistry): { engine: string; variant?: string } {
    if (engines.has(model)) return { engine: model };
    const colon = model.lastIndexOf(':');
    if (colon <= 0) return { engine: model };
    return { engine: model.slice(0, colon), variant: model.slice(colon + 1) };
}

/** The first thing wrong with a body, named the way OpenAI names it. */
function refusalFor(issue: { code: string; path: PropertyKey[]; message: string; keys?: string[] } | undefined): ShimRefusal {
    if (issue === undefined) return new ShimRefusal('bad_request', 'the request body is not an OpenAI speech request', 'input');
    if (issue.code === 'unrecognized_keys' && issue.keys !== undefined && issue.keys.length > 0) {
        return new ShimRefusal('bad_request', `unrecognised request argument "${issue.keys[0]}"; this route takes ${FIELDS}`, issue.keys[0]!);
    }
    const field = String(issue.path[0] ?? 'input');
    return new ShimRefusal('bad_request', `"${field}": ${issue.message}`, field);
}
