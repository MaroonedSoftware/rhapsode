import type { FastifyPluginAsync, onRequestAsyncHookHandler } from 'fastify';

import { RhapsodeError } from '../errors/rhapsode.error.js';
import { OriginRule } from '../management/management.access.policy.js';
import { servicesOf } from './speak.pipeline.js';
import { SpeakStreamSession } from './speak.stream.session.js';

/**
 * A browser does not ask before a page opens a WebSocket, as it asks before a cross-site JSON
 * `POST`, so without this any page the operator visits could drive the engines and hear them. The
 * rule `/mcp` applies (§ 12), before the upgrade, so a refusal is an ordinary 403 envelope.
 */
const originGuard: onRequestAsyncHookHandler = async request => {
    const origin = request.headers.origin;
    if (!request.container.get(OriginRule).admits(origin)) {
        throw new RhapsodeError('forbidden', `/speak/stream does not answer pages from ${origin}; add it to management.origins if it is yours`);
    }
};

/**
 * `GET /speak/stream`, text in as it is written and audio out a sentence at a time. protocol.md § 6.
 *
 * Every piece is spoken through the worker's ordinary `/speak` with `/speak`'s own rules, so the
 * session in `SpeakStreamSession` is about when to speak and nothing about how.
 */
export const speakStreamRoutes: FastifyPluginAsync = async app => {
    app.get('/speak/stream', { websocket: true, onRequest: originGuard }, (socket, request) => {
        new SpeakStreamSession(socket, servicesOf(request));
    });
};
