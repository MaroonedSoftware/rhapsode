import type { McpToolHandler } from '@maroonedsoftware/mcp';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { Capabilities, EngineSummary, Voice } from '@rhapsode/contract';
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
        outputSchema: outputSchema(EngineSummary, 'list'),
        annotations: READ_ONLY,
    };

    constructor(private readonly loopback: LoopbackClient) {}

    async handle(): Promise<CallToolResult> {
        return jsonResult(await this.loopback.request({ method: 'GET', url: '/engines' }), 'list');
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
        outputSchema: outputSchema(Capabilities, 'object'),
        annotations: READ_ONLY,
    };

    constructor(private readonly loopback: LoopbackClient) {}

    async handle(args: Record<string, unknown>): Promise<CallToolResult> {
        const parsed = EngineArguments.safeParse(args);
        if (!parsed.success) return badArguments(parsed.error.issues[0]!.message);
        return jsonResult(
            await this.loopback.request({ method: 'GET', url: `/engines/${encodeURIComponent(parsed.data.engine)}/capabilities` }),
            'object',
        );
    }
}

/** `GET /engines/{engine}/voices`. protocol.md § 12. */
export class ListVoicesTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'list_voices',
        title: 'List voices',
        description: "The voices one engine can speak in. A voice's id is what `speak` takes as `voice`; leaving it out uses the engine's default.",
        inputSchema: inputSchema(EngineArguments),
        outputSchema: outputSchema(Voice, 'list'),
        annotations: READ_ONLY,
    };

    constructor(private readonly loopback: LoopbackClient) {}

    async handle(args: Record<string, unknown>): Promise<CallToolResult> {
        const parsed = EngineArguments.safeParse(args);
        if (!parsed.success) return badArguments(parsed.error.issues[0]!.message);
        return jsonResult(await this.loopback.request({ method: 'GET', url: `/engines/${encodeURIComponent(parsed.data.engine)}/voices` }), 'list');
    }
}

/** A zod object as the JSON Schema a tool advertises, without the dialect line MCP already assumes. */
export function inputSchema(schema: z.ZodObject): Tool['inputSchema'] {
    return jsonSchema(schema, 'input') as Tool['inputSchema'];
}

/**
 * The route's response contract as the tool's `outputSchema`, so a client can check a result against
 * the contract the route answers with rather than against a description of it. A list is wrapped as
 * `{ items }`, because MCP requires structured content to be an object and a schema for anything
 * else is one a client parsing `tools/list` may reject.
 */
export function outputSchema(schema: z.ZodType, shape: 'object' | 'list'): Tool['outputSchema'] {
    const item = jsonSchema(schema, 'output');
    if (shape === 'object') return item as Tool['outputSchema'];
    return { type: 'object', properties: { items: { type: 'array', items: item } }, required: ['items'] };
}

function jsonSchema(schema: z.ZodType, io: 'input' | 'output'): Record<string, unknown> {
    const { $schema: _dialect, ...rest } = z.toJSONSchema(schema, { io }) as Record<string, unknown>;
    return rest;
}
