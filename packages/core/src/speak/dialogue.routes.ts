import type { FastifyPluginAsync } from 'fastify';

import { EngineDialogueRequest } from '@rhapsode/contract';

import { RhapsodeError } from '../errors/rhapsode.error.js';
import { dialogueThrough } from './speak.pipeline.js';

/**
 * `POST /engines/{engine}/dialogue`. A conversation in one take, on a variant that declares one. § 6.
 *
 * The body is parsed against the contract whole, where `/speak` reads its fields by hand, because a
 * dialogue's turns are a shape rather than a field, and a turn missing its speaker is best refused
 * with the path to it. What it means to speak lives in `dialogueThrough`, beside `/speak`'s.
 */
export const dialogueRoutes: FastifyPluginAsync = async app => {
    app.post<{ Params: { engine: string } }>('/engines/:engine/dialogue', { config: { body: ['application/json'] } }, async (request, reply) => {
        const parsed = EngineDialogueRequest.safeParse(request.body ?? {});
        if (!parsed.success) {
            const issue = parsed.error.issues[0]!;
            const where = issue.path.length > 0 ? `\`${issue.path.join('.')}\`: ` : '';
            throw new RhapsodeError('bad_request', `${where}${issue.message}`);
        }
        const body = parsed.data;

        return dialogueThrough(request, reply, {
            engine: request.params.engine,
            turns: body.turns,
            voices: body.voices,
            variant: body.variant,
            format: body.format,
            language: body.language,
            params: body.params,
            seed: body.seed,
            keepAliveSeconds: body.keepAliveSeconds,
            stream: body.stream !== false,
        });
    });
};
