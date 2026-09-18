import type { FastifyPluginAsync } from 'fastify';

import { EngineRegistry } from './engine.registry.js';

/**
 * `GET /engines`, which never spawns anything.
 *
 * This is the list an operator reads to find out what is installed, and it carries both licences so
 * that the weights licence is visible before install rather than after.
 */
export const enginesRoutes: FastifyPluginAsync = async app => {
    app.get('/engines', async request => request.container.get(EngineRegistry).summaries());
};
