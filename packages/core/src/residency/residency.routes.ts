import type { FastifyPluginAsync } from 'fastify';

import { ResidencyManager } from './residency.manager.js';

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
};
