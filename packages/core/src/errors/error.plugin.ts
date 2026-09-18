import type { Container } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import type { ServerKitPlugin } from '@maroonedsoftware/fastify';
import { serverKitPlugin } from '@maroonedsoftware/fastify';

import { asRhapsodeError, RhapsodeError } from './rhapsode.error.js';

/**
 * Render every failure as the protocol's envelope, in place of ServerKit's own error shape.
 *
 * Registered first, before the context plugin, because it installs `setErrorHandler` and a request
 * that fails in the context plugin still has to produce something a client can read.
 *
 * Note what this cannot reach: a handler that has already hijacked its reply. Once `/speak` takes
 * the socket, a failure is an aborted connection rather than a status, and the handler owns that
 * itself. § 6.
 */
export const rhapsodeErrorPlugin = (container: Container): ServerKitPlugin =>
    serverKitPlugin('rhapsode-errors', app => {
        app.setErrorHandler(async (error, request, reply) => {
            const failure = asRhapsodeError(error);
            const logger = request.logger ?? container.get(Logger);

            if (failure.status >= 500) {
                logger.error('request failed', { code: failure.code, path: request.url, error: failure });
            } else {
                logger.debug('request refused', { code: failure.code, path: request.url, reason: failure.message });
            }

            if (reply.raw.headersSent || reply.raw.writableEnded) {
                // The status is already spent. Breaking the connection is the only honest ending,
                // and a clean close here would hand the client a short successful body.
                reply.raw.destroy();
                return reply;
            }

            return reply.status(failure.status).type('application/json').send(failure.envelope());
        });

        app.setNotFoundHandler(async (request, reply) => {
            const failure = new RhapsodeError('bad_request', `no route for ${request.method} ${request.url}`);
            return reply.status(404).type('application/json').send(failure.envelope());
        });
    });
