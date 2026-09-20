import type { FastifyPluginAsync } from 'fastify';

import { EngineSpeakRequest } from '@rhapsode/contract';

import { RhapsodeError } from '../errors/rhapsode.error.js';
import { speakThrough } from './speak.pipeline.js';

const FIELDS = Object.keys(EngineSpeakRequest.shape);

/**
 * The contract's own rule for the one field where a wrong value is worse than a refusal.
 *
 * This route reads its fields by hand, so nothing else here checks a value. `keepAliveSeconds`
 * earns the exception because every wrong value means something: `-2` reads as "never expire" to
 * anything testing for a negative, and a model kept for good is the opposite of what a caller
 * fumbling a number was asking for.
 */
const KEEP_ALIVE = EngineSpeakRequest.shape.keepAliveSeconds;

/**
 * `POST /speak`. The one endpoint that matters, and the one ContractKit cannot express.
 *
 * This reads the native body and nothing more. What it means to speak lives in `speakThrough`, which
 * the OpenAI shim shares, so the two routes cannot come to disagree about any rule in § 6.
 */
export const speakRoutes: FastifyPluginAsync = async app => {
    app.post('/speak', { config: { body: ['application/json'] } }, async (request, reply) => {
        const body = (request.body ?? {}) as Record<string, unknown>;
        // Only the keys, not the whole schema: the contract's SpeakRequest is strict, and a field
        // this route read by hand used to be dropped without a word. `streaming: false` answered with
        // a stream, and nothing told the caller why.
        const unknown = Object.keys(body).find(key => !FIELDS.includes(key));
        if (unknown !== undefined) {
            throw new RhapsodeError('bad_request', `no field "${unknown}"; /speak takes ${[...FIELDS].sort().join(', ')}`);
        }
        const engine = typeof body.engine === 'string' ? body.engine : undefined;
        if (engine === undefined) throw new RhapsodeError('bad_request', '`engine` is required');

        const keepAlive = KEEP_ALIVE.safeParse(body.keepAliveSeconds);
        if (!keepAlive.success) {
            throw new RhapsodeError('bad_request', `\`keepAliveSeconds\`: ${keepAlive.error.issues[0]!.message}`);
        }

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
            keepAliveSeconds: keepAlive.data,
            stream: body.stream !== false,
        });
    });
};
