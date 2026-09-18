import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { Logger } from '@maroonedsoftware/logger';

import type { OpenAIErrorBody } from '@rhapsode/contract';

import { asRhapsodeError, RhapsodeError, type ErrorCode } from '../errors/rhapsode.error.js';

/** A refusal the shim makes itself, about one field of the request it was sent. § 11. */
export class ShimRefusal extends RhapsodeError {
    constructor(
        code: ErrorCode,
        message: string,
        readonly param: string,
    ) {
        super(code, message);
    }
}

/**
 * The request field a failure from inside `/speak` is about. Only the two a code settles: every other
 * refusal the pipeline makes is about text, variant and dials together, and a wrong `param` would
 * send a client's author to the wrong line.
 */
const PARAM_FOR: Partial<Record<ErrorCode, string>> = {
    unknown_engine: 'model',
    unknown_voice: 'voice',
};

/** Any failure, as OpenAI's envelope around § 6's code, status and retryable flag. */
export function openaiEnvelope(failure: RhapsodeError): OpenAIErrorBody {
    const param = failure instanceof ShimRefusal ? failure.param : PARAM_FOR[failure.code];
    return {
        error: {
            message: failure.message,
            type: !failure.retryable && failure.status < 500 ? 'invalid_request_error' : 'server_error',
            ...(param === undefined ? {} : { param }),
            code: failure.code,
            retryable: failure.retryable,
        },
    };
}

/**
 * The shim's error handler, in place of the core's for its one route.
 *
 * Registered on the route rather than globally so that a body the parser refuses is answered in
 * OpenAI's envelope too, which a handler-level catch would miss.
 *
 * `x-should-retry` is the part that matters most. OpenAI's SDKs retry every 5xx twice by default,
 * deciding by status, so without it an `internal` 500, which § 6 says is not retryable, is sent
 * three times. Both official SDKs read the header before the status.
 */
export async function openaiErrorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const failure = asRhapsodeError(error);
    const logger = request.logger ?? request.container.get(Logger);

    if (failure.status >= 500) {
        logger.error('request failed', { code: failure.code, path: request.url, error: failure });
    } else {
        logger.debug('request refused', { code: failure.code, path: request.url, reason: failure.message });
    }

    if (reply.raw.headersSent || reply.raw.writableEnded) {
        // The status is already spent, exactly as in the core's own handler. § 6.
        reply.raw.destroy();
        return reply;
    }

    return reply.status(failure.status).header('x-should-retry', String(failure.retryable)).type('application/json').send(openaiEnvelope(failure));
}
