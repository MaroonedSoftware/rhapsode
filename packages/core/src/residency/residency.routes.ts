import type { FastifyPluginAsync } from 'fastify';

import { RhapsodeError } from '../errors/rhapsode.error.js';
import { managementGuard } from '../management/management.module.js';
import { EngineRegistry } from '../registry/engine.registry.js';
import { ResidencyManager } from './residency.manager.js';

const MODES = ['terminate', 'unload'] as const;

/**
 * `GET /residency`. What is on the card, and when each of it goes. § 3.
 *
 * Reads the core's own state and nothing else: it spawns no worker, loads nothing and cannot block
 * on one, which is the same promise `/health` and `/engines` make. Asking each worker instead would
 * turn "what is loaded" into a reason to start processes that are not, which is precisely the
 * opposite of what somebody looking at a full card wants.
 *
 * Separate from `/health` because they answer different questions to different readers: a monitor
 * polls `/health` and gets every engine's licence with it, and an operator asking where their
 * memory went wants rows about models. It is not a route to consult before speaking; `/speak` loads
 * on demand, and a client that reads this first has rebuilt the per-utterance round trip § 3 exists
 * to remove.
 */
export const residencyRoutes: FastifyPluginAsync = async app => {
    app.get('/residency', async request => {
        const residency = request.container.get(ResidencyManager);
        return { ...residency.summary(), models: residency.models() };
    });

    /**
     * `POST /engines/{engine}/unload`. Give the memory back now. § 3 and § 10.
     *
     * Behind the management guard, because it takes a model away from whatever was about to use it
     * next: a stranger who can empty a card can make every synthesis on this box pay a cold start.
     */
    app.post<{ Params: { engine: string }; Querystring: { mode?: unknown } }>(
        '/engines/:engine/unload',
        { onRequest: managementGuard },
        async request => {
            const engines = request.container.get(EngineRegistry);
            const engine = request.params.engine;
            if (!engines.has(engine)) throw RhapsodeError.unknownEngine(engine, engines.ids());

            const { mode } = request.query;
            if (mode !== undefined && !MODES.includes(mode as (typeof MODES)[number])) {
                throw new RhapsodeError('bad_request', `\`mode\` is ${MODES.join(' or ')}, and defaults to terminate`);
            }

            // Terminate by default: an unload leaves roughly 30% of the card behind, and somebody
            // asking for memory back means all of it.
            await request.container.get(ResidencyManager).free(engine, (mode as (typeof MODES)[number]) ?? 'terminate');
            return engines.summaries().find(summary => summary.id === engine);
        },
    );
};
