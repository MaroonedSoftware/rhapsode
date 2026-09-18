import type { FastifyPluginAsync } from 'fastify';

import { RhapsodeError } from '../errors/rhapsode.error.js';
import { speakThrough } from './speak.pipeline.js';

/**
 * `POST /speak`. The one endpoint that matters, and the one ContractKit cannot express.
 *
 * This reads the native body and nothing more. What it means to speak lives in `speakThrough`, which
 * the OpenAI shim shares, so the two routes cannot come to disagree about any rule in § 6.
 */
export const speakRoutes: FastifyPluginAsync = async app => {
    app.post('/speak', { config: { body: ['application/json'] } }, async (request, reply) => {
        const body = (request.body ?? {}) as Record<string, unknown>;
        const engine = typeof body.engine === 'string' ? body.engine : undefined;
        if (engine === undefined) throw new RhapsodeError('bad_request', '`engine` is required');

        return speakThrough(request, reply, {
            engine,
            text: typeof body.text === 'string' ? body.text : '',
            voice: typeof body.voice === 'string' ? body.voice : undefined,
            variant: typeof body.variant === 'string' ? body.variant : undefined,
            format: typeof body.format === 'string' ? body.format : undefined,
            language: typeof body.language === 'string' ? body.language : undefined,
            delivery: typeof body.delivery === 'string' ? body.delivery : undefined,
            params: body.params as Record<string, number> | undefined,
            seed: typeof body.seed === 'number' ? body.seed : undefined,
            stream: body.stream !== false,
        });
    });
};
