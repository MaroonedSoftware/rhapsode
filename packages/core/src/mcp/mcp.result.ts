import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ErrorBody } from '@rhapsode/contract';

import type { LoopbackResponse } from './mcp.loopback.js';

/**
 * A route's JSON answer as a tool result, or its refusal as one with `isError`.
 *
 * Both structured and as text: `structuredContent` is what a client checks against the tool's
 * `outputSchema`, and the text is the same JSON for a client that predates structured results. MCP
 * requires structured content to be an object, so a list goes out as `{ items }`, the shape
 * `outputSchema` declares for it.
 */
export function jsonResult(response: LoopbackResponse, shape: 'object' | 'list'): CallToolResult {
    if (response.status >= 400) return refusal(response);
    const body = response.json();
    const structured = shape === 'list' ? { items: body } : (body as Record<string, unknown>);
    return { content: [{ type: 'text', text: JSON.stringify(body, undefined, 2) }], structuredContent: structured };
}

/**
 * A route's error envelope as a tool that ran and failed. protocol.md § 12.
 *
 * Not a JSON-RPC error: a client reports one of those to its user and stops, where an agent reads a
 * failed tool's text and can act on it. `unknown_voice` names the voices there are, and the next
 * call is the one that picks a real one.
 */
export function refusal(response: LoopbackResponse): CallToolResult {
    let parsed: ReturnType<typeof ErrorBody.safeParse> | undefined;
    try {
        parsed = ErrorBody.safeParse(response.json());
    } catch {
        // A body that is not JSON: nothing in the core answers one, but a status alone still says enough.
    }
    const text = parsed?.success
        ? `${parsed.data.error.code}: ${parsed.data.error.message} (retryable: ${parsed.data.error.retryable})`
        : `the route answered ${response.status}`;
    return { isError: true, content: [{ type: 'text', text }] };
}

/** A tool's arguments that fail its own schema, answered the way a route answers a bad body. */
export function badArguments(message: string): CallToolResult {
    return { isError: true, content: [{ type: 'text', text: `bad_request: ${message} (retryable: false)` }] };
}
