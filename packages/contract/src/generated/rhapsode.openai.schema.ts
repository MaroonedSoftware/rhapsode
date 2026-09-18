import { z } from 'zod';

/**
 * Strict, like every request here: OpenAI's own API refuses a field it does not recognise with a 400,
 * so a refusal holds a client to nothing it was not already held to.
 * generated from [OpenAISpeechRequest](../../../../contracts/rhapsode.openai.ck#L16)
 */
export const OpenAISpeechRequest = z.strictObject({
    model: z.string().min(1).describe('An engine id, or `engine:variant`.'),
    input: z.string().min(1),
    voice: z.string().optional().describe("Absent means the engine's default."),
    response_format: z.enum(['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm']).optional().describe('Absent means mp3. aac is always refused.'),
    speed: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number())
        .optional()
        .describe('Carried by a `speed` dial, or refused.'),
    instructions: z.string().optional().describe('Refused unless empty.'),
    stream_format: z.enum(['audio', 'sse']).optional().describe('sse is always refused.'),
});
export type OpenAISpeechRequest = z.infer<typeof OpenAISpeechRequest>;

/**
 * generated from [OpenAIErrorDetail](../../../../contracts/rhapsode.openai.ck#L26)
 */
export const OpenAIErrorDetail = z.looseObject({
    message: z.string(),
    type: z.enum(['invalid_request_error', 'server_error']),
    param: z.string().optional().describe('The request field the failure is about.'),
    code: z
        .string()
        .describe(
            'The taxonomy code from protocol.md § 6. A string rather than the enum, so a code from a newer\ncontract does not cost a client the envelope. § 9.',
        ),
    retryable: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()),
});
export type OpenAIErrorDetail = z.infer<typeof OpenAIErrorDetail>;

/**
 * generated from [OpenAIErrorBody](../../../../contracts/rhapsode.openai.ck#L36)
 */
export const OpenAIErrorBody = z.looseObject({
    error: OpenAIErrorDetail,
});
export type OpenAIErrorBody = z.infer<typeof OpenAIErrorBody>;
