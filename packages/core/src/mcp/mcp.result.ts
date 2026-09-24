import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ErrorBody } from '@rhapsode/contract';

import type { LoopbackResponse } from './mcp.loopback.js';

/** A route's JSON answer as a tool result, or its refusal as one with `isError`. */
export function jsonResult(response: LoopbackResponse): CallToolResult {
    if (response.status >= 400) return refusal(response);
    return { content: [{ type: 'text', text: JSON.stringify(response.json(), undefined, 2) }] };
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
