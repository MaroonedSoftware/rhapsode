import { PullRequest } from '@rhapsode/contract';
import type { FastifyPluginAsync } from 'fastify';

import { RhapsodeError } from '../errors/rhapsode.error.js';
import { managementGuard } from '../management/management.module.js';
import { EngineInstaller } from './engine.installer.js';
import { InstallJobs } from './install.jobs.js';

/** Install, uninstall, and the job reads. All behind the management guard. protocol.md § 10. */
export const installRoutes: FastifyPluginAsync = async app => {
    app.post<{ Params: { engine: string } }>('/engines/:engine/install', { onRequest: managementGuard }, async (request, reply) => {
        const job = request.container.get(EngineInstaller).install(request.params.engine);
        return reply.status(202).send(job);
    });

    app.post<{ Params: { engine: string } }>(
        '/engines/:engine/pull',
        { onRequest: managementGuard, config: { body: ['application/json'] } },
        async (request, reply) => {
            const parsed = PullRequest.safeParse(request.body ?? {});
            if (!parsed.success) throw new RhapsodeError('bad_request', `the body is not a pull request: ${parsed.error.message}`);
            const job = request.container.get(EngineInstaller).pull(request.params.engine, parsed.data.variant);
            return reply.status(202).send(job);
        },
    );

    app.delete<{ Params: { engine: string } }>('/engines/:engine', { onRequest: managementGuard }, async (request, reply) => {
        await request.container.get(EngineInstaller).uninstall(request.params.engine);
        return reply.status(204).send();
    });

    app.get('/installs', { onRequest: managementGuard }, async request => request.container.get(InstallJobs).list());

    app.get<{ Params: { job: string } }>('/installs/:job', { onRequest: managementGuard }, async (request, reply) => {
        const job = request.container.get(InstallJobs).get(request.params.job);
        if (job !== undefined) return job;
        // No code in the taxonomy means "no such job", and the not-found handler's precedent is
        // `bad_request` with a 404: the request named something that is not there.
        return reply.status(404).send(new RhapsodeError('bad_request', `no install job "${request.params.job}"`).envelope());
    });
};
