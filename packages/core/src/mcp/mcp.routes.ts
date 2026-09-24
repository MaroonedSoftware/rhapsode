import type { FastifyPluginAsync, onRequestAsyncHookHandler } from 'fastify';
import { createMcpRequestContext, McpDispatcher } from '@maroonedsoftware/mcp';
import { JSONRPCMessageSchema } from '@modelcontextprotocol/sdk/types.js';

import { RhapsodeError } from '../errors/rhapsode.error.js';
import { OriginRule } from '../management/management.access.policy.js';
import { LoopbackClient } from './mcp.loopback.js';

/**
 * The transport requires a server to check `Origin`, and the reason is the one § 10 measured: a
 * page the operator visits can make their browser POST here. An agent sends no `Origin` and is
 * admitted, as it would be at `/speak`.
 */
const originGuard: onRequestAsyncHookHandler = async request => {
    const origin = request.headers.origin;
    if (!request.container.get(OriginRule).admits(origin)) {
        throw new RhapsodeError('forbidden', `/mcp does not answer pages from ${origin}; add it to management.origins if it is yours`);
    }
};

/**
 * `POST /mcp`, the MCP server, stateless over Streamable HTTP. protocol.md § 12.
 *
 * One JSON-RPC message in, one JSON response out, or a bare 202 for a notification. There is no
 * session and no stream, so GET and DELETE, which are how a client opens a stream and ends a
 * session, answer 405 as the transport says a server without them should.
 */
export const mcpRoutes: FastifyPluginAsync = async app => {
    app.post('/mcp', { config: { body: ['application/json'] }, onRequest: originGuard }, async (request, reply) => {
        const message = JSONRPCMessageSchema.safeParse(request.body);
        if (!message.success) {
            return reply.code(400).send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'the body is not one JSON-RPC message' } });
        }

        request.container.get(LoopbackClient).bind(request.server);
        const context = createMcpRequestContext({ requestId: request.requestId, logger: request.logger });
        const response = await request.container.get(McpDispatcher).dispatch(message.data, context);
        if (response === undefined) return reply.code(202).send();
        return response;
    });

    for (const method of ['GET', 'DELETE'] as const) {
        app.route({
            method,
            url: '/mcp',
            onRequest: originGuard,
            handler: async (_request, reply) => reply.code(405).header('allow', 'POST').send(),
        });
    }
};
