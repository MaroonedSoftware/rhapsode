import { DispatchError } from '@rhapsode/contract';

/** Every code in the taxonomy, with the status and the retryability each one carries. § 6. */
export const TAXONOMY = {
    bad_request: { status: 400, retryable: false },
    unknown_engine: { status: 404, retryable: false },
    unknown_voice: { status: 404, retryable: false },
    unsupported: { status: 422, retryable: false },
    model_unavailable: { status: 503, retryable: true },
    oom: { status: 503, retryable: true },
    overloaded: { status: 429, retryable: true },
    internal: { status: 500, retryable: false },
    forbidden: { status: 403, retryable: false },
    conflict: { status: 409, retryable: false },
} as const;

export type ErrorCode = keyof typeof TAXONOMY;

/**
 * A failure the core can put on the wire as the protocol's envelope.
 *
 * `retryable` comes from the code rather than from the caller, so the two cannot disagree. The
 * distinction it draws is between "this request was wrong" and "this request was fine and the
 * server was not", and a caller that conflates them either retries a permanent failure forever or
 * discards work that would have succeeded on the next pass.
 */
export class RhapsodeError extends Error {
    readonly status: number;
    readonly retryable: boolean;

    constructor(
        readonly code: ErrorCode,
        message: string,
        options?: { cause?: unknown },
    ) {
        super(message, options);
        this.name = 'RhapsodeError';
        this.status = TAXONOMY[code].status;
        this.retryable = TAXONOMY[code].retryable;
    }

    envelope(): { error: { code: ErrorCode; message: string; retryable: boolean } } {
        return { error: { code: this.code, message: this.message, retryable: this.retryable } };
    }

    static unknownEngine(id: string, known: string[]): RhapsodeError {
        return new RhapsodeError(
            'unknown_engine',
            `no engine "${id}"; this server has ${known.length > 0 ? known.sort().join(', ') : 'none installed'}`,
        );
    }
}

/**
 * Whatever went wrong, as an envelope.
 *
 * A worker's own envelope is passed through unchanged where one arrived, because the worker knows
 * more about its failure than the core does. An error code the core has never heard of keeps its
 * message and its retryable flag and loses only the code: those two are what decide what the caller
 * does next, and losing them because a newer worker used a newer code is the worst possible trade.
 */
export function asRhapsodeError(error: unknown): RhapsodeError {
    if (error instanceof RhapsodeError) return error;

    if (error instanceof DispatchError) {
        return new RhapsodeError(error.code, error.message, { cause: error });
    }

    return new RhapsodeError('internal', error instanceof Error ? error.message : String(error), { cause: error });
}

/** Read a worker's error envelope, tolerating a code from a contract we have not met. § 9. */
export function fromWorkerEnvelope(body: unknown, fallbackStatus: number): RhapsodeError {
    const envelope = (body as { error?: { code?: unknown; message?: unknown; retryable?: unknown } } | null)?.error;
    const message = typeof envelope?.message === 'string' ? envelope.message : 'the worker failed and said nothing useful';
    const code = typeof envelope?.code === 'string' && envelope.code in TAXONOMY ? (envelope.code as ErrorCode) : undefined;

    if (code !== undefined) return new RhapsodeError(code, message);

    // An unfamiliar code, or none at all. Keep what the worker said and derive the rest from the
    // status it used, which is the one signal that cannot be unfamiliar.
    const derived = (Object.entries(TAXONOMY) as [ErrorCode, { status: number }][]).find(([, entry]) => entry.status === fallbackStatus);
    return new RhapsodeError(derived?.[0] ?? 'internal', message);
}
