import { SdkError, type ErrorBody } from '@maroonedsoftware/rhapsode-sdk';

/**
 * A refusal the core declared and explained: the protocol's envelope, carried as an error so a
 * query or a mutation fails with it.
 *
 * The SDK returns a declared refusal (a 409 from an install, say) as a value rather than throwing,
 * which is right for a caller that branches on it and wrong for TanStack Query, which only knows
 * about failure by a rejection. `unwrap` is the one place that turns one into the other.
 */
export class ApiRefusal extends Error {
    constructor(
        readonly status: number,
        readonly code: string,
        message: string,
    ) {
        super(message);
        this.name = 'ApiRefusal';
    }
}

type Declared<T> = { status: number; data?: T | ErrorBody };

/** The success value of an operation that declares its refusals, or its refusal thrown. */
export function unwrap<T>(result: Declared<T>): T {
    if (result.status >= 400) {
        const envelope = (result.data as ErrorBody | undefined)?.error;
        throw new ApiRefusal(result.status, envelope?.code ?? 'internal', envelope?.message ?? `the server answered ${result.status}`);
    }
    return result.data as T;
}

/** The protocol's code, whichever way the failure arrived. */
export function apiErrorCode(error: unknown): string | undefined {
    if (error instanceof ApiRefusal) return error.code;
    if (error instanceof SdkError) return (error.body as ErrorBody | undefined)?.error?.code;
    return undefined;
}

/** A sentence for an alert: the one the core wrote when there is one, otherwise the caller's. */
export function apiErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof ApiRefusal) return error.message;
    if (error instanceof SdkError) {
        const message = (error.body as ErrorBody | undefined)?.error?.message;
        if (typeof message === 'string' && message.length > 0) return message;
    }
    return fallback;
}

/**
 * Nothing answered: `fetch` rejected, or the proxy answered 502 because the core is not running.
 * The fix is the same either way, and it is not in the page.
 */
export function isUnreachable(error: unknown): boolean {
    if (error instanceof TypeError) return true;
    return error instanceof SdkError && (error.status === 502 || error.status === 503 || error.status === 504) && apiErrorCode(error) === undefined;
}
