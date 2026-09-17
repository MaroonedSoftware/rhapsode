import type { FastifyPluginAsync } from 'fastify';

import { CONTRACT_MAJOR } from '@rhapsode/contract';

import { EngineRegistry } from '../registry/engine.registry.js';

/**
 * `GET /health`, the core's own.
 *
 * It answers while every worker is down and never blocks on one. A health endpoint that waits on
 * the thing it reports about is a health endpoint that times out exactly when you need it, which is
 * the same argument § 2 makes for a handshake line over a poll loop.
 */
export const healthRoutes: FastifyPluginAsync = async app => {
    app.get('/health', async request => {
        const registry = request.container.get(EngineRegistry);
        const engines = registry.summaries();

        return {
            contract: CONTRACT_MAJOR,
            status: engines.some(engine => engine.process === 'failed') ? 'degraded' : 'ok',
            engines,
            residency: registry.residency(),
        };
    });
};
