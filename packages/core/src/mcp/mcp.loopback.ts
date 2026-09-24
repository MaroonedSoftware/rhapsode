import type { FastifyInstance, InjectOptions } from 'fastify';

/** What a public route answered, read once. */
export interface LoopbackResponse {
    status: number;
    headers: Record<string, string | string[] | number | undefined>;
    body: Buffer;
    /** The body as JSON, for the routes that answer JSON. Throws on one that does not. */
    json(): unknown;
}

/**
 * The core's own router, reached in process. protocol.md § 12.
 *
 * Every MCP tool is a request to a public route, run through here, so the ceiling, the cue
 * stripping, the lease and the error envelope are the route's and not a copy of them. The OpenAI
 * shim reaches the same rules by calling `speakThrough`; a tool cannot, because it answers a
 * JSON-RPC message and not a Fastify reply, and `inject` is the one way in that needs neither.
 *
 * Bound by the route plugin, because the instance does not exist when the container is built.
 */
export class LoopbackClient {
    private app?: FastifyInstance;

    bind(app: FastifyInstance): void {
        this.app = app;
    }

    async request(options: { method: 'GET' | 'POST'; url: string; body?: unknown }): Promise<LoopbackResponse> {
        if (this.app === undefined) throw new Error('the MCP loopback was used before the route plugin bound it');
        const inject: InjectOptions = { method: options.method, url: options.url };
        if (options.body !== undefined) {
            inject.payload = JSON.stringify(options.body);
            inject.headers = { 'content-type': 'application/json' };
        }
        const response = await this.app.inject(inject);
        return {
            status: response.statusCode,
            headers: response.headers,
            body: response.rawPayload,
            json: () => response.json(),
        };
    }
}
