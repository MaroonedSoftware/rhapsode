import { handleServerFeed } from '@maroonedsoftware/servercore/serverfeed';
import type { FastifyPluginAsync } from 'fastify';

import { RhapsodeError } from '../errors/rhapsode.error.js';
import { managementGuard } from '../management/management.module.js';
import { InstallJobs } from './install.jobs.js';

/**
 * `GET /installs/{job}/events`: one job's feed events as server-sent events. protocol.md § 10.
 *
 * ServerKit's `handleServerFeed` does the work: replay from `Last-Event-ID`, a `resync` when the
 * resume point has fallen out of the buffer, heartbeat, backpressure, and closing on `signal` so a
 * shutdown is not held open by a client still watching. This mounts it the way ServerKit's own
 * `serverFeedRoutes` does, with two differences: the management guard in place of a session
 * policy, and the filter pinned to one job, so a caller cannot widen it to every job's output with
 * a query parameter.
 *
 * It hijacks the reply, so like `/speak` it owns its own failures once the headers are gone.
 */
export const installEventsRoutes =
    (signal: AbortSignal): FastifyPluginAsync =>
    async app => {
        app.get<{ Params: { job: string } }>('/installs/:job/events', { onRequest: managementGuard }, async (request, reply) => {
            const jobs = request.container.get(InstallJobs);
            const job = jobs.get(request.params.job);
            if (job === undefined) {
                return reply.status(404).send(new RhapsodeError('bad_request', `no install job "${request.params.job}"`).envelope());
            }

            handleServerFeed(
                {
                    res: reply.raw,
                    hijack: () => void reply.hijack(),
                    query: { ...(request.query as Record<string, unknown>), correlationId: job.id },
                    get: name => {
                        const value = request.headers[name.toLowerCase()];
                        return typeof value === 'string' ? value : '';
                    },
                },
                jobs.feed,
                { signal },
            );
            return reply;
        });
    };
