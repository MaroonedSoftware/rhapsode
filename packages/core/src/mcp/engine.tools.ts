import type { McpToolHandler } from '@maroonedsoftware/mcp';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import type { LoopbackClient } from './mcp.loopback.js';
import { badArguments, jsonResult } from './mcp.result.js';

const EngineArguments = z.strictObject({
    engine: z.string().min(1).describe('An engine id, as list_engines names it.'),
});

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

/** `GET /engines`. protocol.md § 12. */
export class ListEnginesTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'list_engines',
        title: 'List engines',
        description:
            'Every speech engine installed on this rhapsode server, with its variants and licences. Start here: every other tool takes an engine id from this list.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: READ_ONLY,
    };

    constructor(private readonly loopback: LoopbackClient) {}

    async handle(): Promise<CallToolResult> {
        return jsonResult(await this.loopback.request({ method: 'GET', url: '/engines' }));
    }
}

/** `GET /engines/{engine}/capabilities`. protocol.md § 12. */
export class EngineCapabilitiesTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'engine_capabilities',
        title: 'Engine capabilities',
        description:
            "What one engine can do, per variant: output formats, languages, the most characters a request may carry, the cues and deliveries it performs, and the dials `speak` may set in `params`. Read it before speak to learn what the engine's params and cues are.",
        inputSchema: inputSchema(EngineArguments),
        annotations: READ_ONLY,
    };

    constructor(private readonly loopback: LoopbackClient) {}

    async handle(args: Record<string, unknown>): Promise<CallToolResult> {
        const parsed = EngineArguments.safeParse(args);
        if (!parsed.success) return badArguments(parsed.error.issues[0]!.message);
        return jsonResult(await this.loopback.request({ method: 'GET', url: `/engines/${encodeURIComponent(parsed.data.engine)}/capabilities` }));
    }
}

/** `GET /engines/{engine}/voices`. protocol.md § 12. */
export class ListVoicesTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'list_voices',
        title: 'List voices',
        description: "The voices one engine can speak in. A voice's id is what `speak` takes as `voice`; leaving it out uses the engine's default.",
        inputSchema: inputSchema(EngineArguments),
        annotations: READ_ONLY,
    };

    constructor(private readonly loopback: LoopbackClient) {}

    async handle(args: Record<string, unknown>): Promise<CallToolResult> {
        const parsed = EngineArguments.safeParse(args);
        if (!parsed.success) return badArguments(parsed.error.issues[0]!.message);
        return jsonResult(await this.loopback.request({ method: 'GET', url: `/engines/${encodeURIComponent(parsed.data.engine)}/voices` }));
    }
}

/** A zod object as the JSON Schema a tool advertises, without the dialect line MCP already assumes. */
export function inputSchema(schema: z.ZodObject): Tool['inputSchema'] {
    const { $schema: _dialect, ...rest } = z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>;
    return rest as Tool['inputSchema'];
}
