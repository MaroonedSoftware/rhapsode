import type { FastifyPluginAsync } from 'fastify';

import { UpdateChecker } from './update.checker.js';

/**
 * `GET /update`: whether a newer release exists. § 9.
 *
 * Open to every caller. The version is already `info.version` on `/openapi.json` and the latest
 * release is public, so the only thing an open route adds is whether this box checks. It cannot be
 * used to make the box phone out more often: it never waits on GitHub, and an answer stands a day.
 */
export const updateRoutes: FastifyPluginAsync = async app => {
    app.get('/update', async request => request.container.get(UpdateChecker).status());

    /**
     * Ask now, for a person who has just read that a release is out. Open like the read, and bounded
     * by the checker instead: one request to GitHub in five minutes however often this is called.
     */
    app.post('/update/check', async request => request.container.get(UpdateChecker).checkNow());
};
