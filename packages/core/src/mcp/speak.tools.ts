import type { McpToolHandler } from '@maroonedsoftware/mcp';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { EngineDialogueRequest, EngineSpeakRequest } from '@rhapsode/contract';
import type { z } from 'zod';

import { DURATION_HEADER } from '../workers/worker.client.js';
import { inputSchema } from './engine.tools.js';
import type { LoopbackClient, LoopbackResponse } from './mcp.loopback.js';
import { badArguments, refusal } from './mcp.result.js';

/**
 * `wav` rather than whatever `/speak` would pick, because it is the one format that needs nothing on
 * the worker's box. `mp3` and `opus` need ffmpeg, and an agent that says nothing should not be
 * refused on a machine that lacks it. protocol.md § 12.
 */
const DEFAULT_FORMAT = 'wav';

const FORMAT = EngineSpeakRequest.shape.format.describe(
    'wav, the default here, needs nothing on the server. mp3 and opus need ffmpeg there; pcm is the engine’s own rate, named in the mime type.',
);

// `stream` is left out rather than accepted and overridden: a tool result is one message, so there
// is only ever the buffered answer, and a field that cannot change anything should not be offered.
const SpeakArguments = EngineSpeakRequest.omit({ stream: true }).extend({ format: FORMAT });
const DialogueArguments = EngineDialogueRequest.omit({ stream: true }).extend({
    engine: EngineSpeakRequest.shape.engine.describe('An engine id whose variant declares dialogue in engine_capabilities.'),
    format: FORMAT,
});

const SPEAKS = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;

/** `POST /speak`, buffered, answered as audio content. protocol.md § 12. */
export class SpeakTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'speak',
        title: 'Speak',
        description:
            'Speak a line of text with one engine and return the audio. Cues the variant does not perform are removed from the text rather than read aloud; engine_capabilities says which it performs, and which dials `params` may set.',
        inputSchema: inputSchema(SpeakArguments),
        annotations: SPEAKS,
    };

    constructor(private readonly loopback: LoopbackClient) {}

    async handle(args: Record<string, unknown>): Promise<CallToolResult> {
        const parsed = SpeakArguments.safeParse(args);
        if (!parsed.success) return badArguments(described(parsed.error));
        const body = { ...parsed.data, format: parsed.data.format ?? DEFAULT_FORMAT, stream: false };

        const response = await this.loopback.request({ method: 'POST', url: '/speak', body });
        return audioResult(response, [`engine ${body.engine}`, parsed.data.voice === undefined ? 'its default voice' : `voice ${parsed.data.voice}`]);
    }
}

/** `POST /engines/{engine}/dialogue`, buffered, answered as audio content. protocol.md § 12. */
export class SpeakDialogueTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'speak_dialogue',
        title: 'Speak a dialogue',
        description:
            'Speak a conversation between speakers in one take, on an engine whose variant declares dialogue. Speakers are labels the request makes up; `voices` maps a label to a voice id, and an unvoiced speaker is the engine’s choice.',
        inputSchema: inputSchema(DialogueArguments),
        annotations: SPEAKS,
    };

    constructor(private readonly loopback: LoopbackClient) {}

    async handle(args: Record<string, unknown>): Promise<CallToolResult> {
        const parsed = DialogueArguments.safeParse(args);
        if (!parsed.success) return badArguments(described(parsed.error));
        const { engine, ...rest } = parsed.data;
        const body = { ...rest, format: rest.format ?? DEFAULT_FORMAT, stream: false };

        const response = await this.loopback.request({ method: 'POST', url: `/engines/${encodeURIComponent(engine)}/dialogue`, body });
        return audioResult(response, [`engine ${engine}`, `${rest.turns.length} turns`]);
    }
}

/**
 * The audio as MCP audio content, with a line of text for a client that cannot play it.
 *
 * The mime type is the route's `Content-Type` verbatim, because § 6 makes that authoritative and the
 * core holds no format table: `audio/L16; rate=24000; channels=1` is the only place pcm's rate is
 * written down.
 */
function audioResult(response: LoopbackResponse, said: string[]): CallToolResult {
    if (response.status >= 400) return refusal(response);
    const mimeType = String(response.headers['content-type']);
    const duration = response.headers[DURATION_HEADER];
    const summary = [...said, mimeType, duration === undefined ? undefined : `${duration} ms`, `${response.body.length} bytes`];
    return {
        content: [
            { type: 'audio', data: response.body.toString('base64'), mimeType },
            { type: 'text', text: `Spoke with ${summary.filter(part => part !== undefined).join(', ')}.` },
        ],
    };
}

/** The first thing wrong, with the path to it, as the dialogue route words it. */
function described(error: z.ZodError): string {
    const issue = error.issues[0]!;
    return issue.path.length > 0 ? `\`${issue.path.join('.')}\`: ${issue.message}` : issue.message;
}
