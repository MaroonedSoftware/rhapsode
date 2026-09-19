import { Readable } from 'node:stream';

import { Pool } from 'undici';

import type { Capabilities, Voice, WorkerHealth } from '@rhapsode/contract';

import { fromWorkerEnvelope, RhapsodeError } from '../errors/rhapsode.error.js';

/**
 * A long synthesis on a cold CPU legitimately stalls, so the body is not on a clock. The headers
 * are, because that is the phase where a wedged worker is indistinguishable from a slow one, which
 * is the same distinction § 2 draws about the handshake.
 */
export const HEADERS_TIMEOUT_MS = 120_000;

/** Long enough to survive a cold model load, which is the slowest thing a control call can wait on. */
export const CONTROL_TIMEOUT_MS = 300_000;

export interface WorkerTransport {
    /** A local worker. */
    socketPath?: string;
    /** A remote worker. Exactly one of these two is set, and that is the whole difference. */
    url?: string;
}

/**
 * Everything the core says to a worker.
 *
 * Local and remote differ by one constructor argument and nothing else, which is what makes § 1's
 * "a remote worker is a URL" true in code rather than in prose. `undici.Pool` rather than `fetch`
 * because it hands back a Node `Readable` already, instead of a web stream to convert back, and
 * because it exposes trailers at all.
 */
export class WorkerClient {
    private readonly pool: Pool;

    constructor(transport: WorkerTransport) {
        this.pool =
            transport.socketPath === undefined
                ? new Pool(transport.url!, { pipelining: 1, headersTimeout: HEADERS_TIMEOUT_MS, bodyTimeout: 0 })
                : // The origin is a placeholder the connector ignores; it only keeps a sane Host header.
                  new Pool('http://localhost', {
                      connect: { socketPath: transport.socketPath },
                      pipelining: 1,
                      headersTimeout: HEADERS_TIMEOUT_MS,
                      bodyTimeout: 0,
                  });
    }

    async health(): Promise<WorkerHealth> {
        return this.json<WorkerHealth>('GET', '/health');
    }

    async capabilities(): Promise<Capabilities> {
        return this.json<Capabilities>('GET', '/capabilities');
    }

    async voices(): Promise<Voice[]> {
        return this.json<Voice[]>('GET', '/voices');
    }

    async load(variant?: string): Promise<WorkerHealth> {
        return this.json<WorkerHealth>('POST', '/load', variant === undefined ? {} : { variant });
    }

    async unload(): Promise<WorkerHealth> {
        return this.json<WorkerHealth>('POST', '/unload', {});
    }

    /**
     * Download a variant's weights without loading them. § 8.
     *
     * On no clock at all: the worker answers once the download is done, and Chatterbox's three
     * builds came to 9.7 GB. A timeout short enough to catch a wedged worker would also cut off a
     * slow connection halfway through, and the job this runs in already has a cancel, which is
     * shutdown.
     */
    async fetch(variant: string, signal: AbortSignal): Promise<void> {
        let response;
        try {
            response = await this.pool.request({
                path: '/fetch',
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ variant }),
                signal,
                headersTimeout: 0,
                bodyTimeout: 0,
            });
        } catch (error) {
            throw new RhapsodeError('model_unavailable', 'the worker did not answer POST /fetch', { cause: error });
        }
        if (response.statusCode >= 400) {
            throw fromWorkerEnvelope(await response.body.json().catch(() => undefined), response.statusCode);
        }
        await response.body.dump();
    }

    /**
     * A clone, streamed to the worker as it arrives. § 7.
     *
     * The body is the caller's multipart upload, passed through with its own `Content-Type` so the
     * boundary survives, and never parsed or held here: the core keeps no copy of a voice.
     */
    async createVoice(body: Readable, contentType: string, signal: AbortSignal): Promise<Voice> {
        let response;
        try {
            response = await this.pool.request({
                path: '/voices',
                method: 'POST',
                headers: { 'content-type': contentType },
                body,
                signal,
                headersTimeout: CONTROL_TIMEOUT_MS,
                bodyTimeout: CONTROL_TIMEOUT_MS,
            });
        } catch (error) {
            // The cap tripping mid-upload arrives here as the body's own error, and is the caller's.
            if (error instanceof RhapsodeError) throw error;
            if ((error as { cause?: unknown }).cause instanceof RhapsodeError) throw (error as { cause: RhapsodeError }).cause;
            throw new RhapsodeError('model_unavailable', 'the worker did not answer POST /voices', { cause: error });
        }
        const parsed = await response.body.json().catch(() => undefined);
        if (response.statusCode >= 400) throw fromWorkerEnvelope(parsed, response.statusCode);
        return parsed as Voice;
    }

    async deleteVoice(voice: string): Promise<void> {
        const response = await this.request('DELETE', `/voices/${encodeURIComponent(voice)}`);
        if (response.statusCode >= 400) {
            throw fromWorkerEnvelope(await response.body.json().catch(() => undefined), response.statusCode);
        }
        await response.body.dump();
    }

    /** Drain and exit. The 202 arrives before the process goes, so the socket closing is the proof. */
    async terminate(): Promise<void> {
        await this.request('POST', '/terminate', {});
    }

    /**
     * Synthesis, with the worker's headers awaited before anything is committed to the client.
     *
     * The caller gets the body only once a 2xx and a Content-Type are in hand, so everything that
     * can fail cleanly has already done so. § 6.
     */
    async speak(body: unknown, signal: AbortSignal): Promise<SpokenResponse> {
        const response = await this.pool.request({
            path: '/speak',
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
            signal,
            headersTimeout: HEADERS_TIMEOUT_MS,
            bodyTimeout: 0,
        });

        if (response.statusCode >= 400) {
            const failure = fromWorkerEnvelope(await response.body.json().catch(() => undefined), response.statusCode);
            throw failure;
        }

        return {
            contentType: String(response.headers['content-type'] ?? 'application/octet-stream'),
            trailer: typeof response.headers.trailer === 'string' ? response.headers.trailer : undefined,
            durationMs: typeof response.headers[DURATION_HEADER] === 'string' ? response.headers[DURATION_HEADER] : undefined,
            body: response.body as unknown as Readable,
            trailers: () => response.trailers,
        };
    }

    /** A fixed line in one voice, which every engine gets for free from the SDK. § 7. */
    async preview(voice: string, signal: AbortSignal): Promise<SpokenResponse> {
        const response = await this.pool.request({
            path: `/voices/${encodeURIComponent(voice)}/preview`,
            method: 'GET',
            signal,
            headersTimeout: HEADERS_TIMEOUT_MS,
            bodyTimeout: 0,
        });

        if (response.statusCode >= 400) {
            throw fromWorkerEnvelope(await response.body.json().catch(() => undefined), response.statusCode);
        }

        return {
            contentType: String(response.headers['content-type'] ?? 'application/octet-stream'),
            body: response.body as unknown as Readable,
            trailers: () => response.trailers,
        };
    }

    async close(): Promise<void> {
        await this.pool.destroy();
    }

    private async json<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
        const response = await this.request(method, path, body);
        const parsed = await response.body.json().catch(() => undefined);

        if (response.statusCode >= 400) {
            throw fromWorkerEnvelope(parsed, response.statusCode);
        }
        return parsed as T;
    }

    private async request(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown) {
        try {
            return await this.pool.request({
                path,
                method,
                headersTimeout: CONTROL_TIMEOUT_MS,
                bodyTimeout: CONTROL_TIMEOUT_MS,
                ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
            });
        } catch (error) {
            // A worker that is not answering is not a client mistake. `model_unavailable` keeps the
            // job on the caller's side rather than writing it off, which is exactly the distinction
            // `retryable` exists to draw.
            throw new RhapsodeError('model_unavailable', `the worker did not answer ${method} ${path}`, {
                cause: error,
            });
        }
    }
}

/** § 6. A header on a buffered answer, and only there, because only there is it known in time. */
export const DURATION_HEADER = 'x-rhapsode-duration-ms';

export interface SpokenResponse {
    contentType: string;
    trailer?: string;
    /** The worker's `X-Rhapsode-Duration-Ms`, verbatim, when it sent one. */
    durationMs?: string;
    body: Readable;
    trailers: () => Record<string, string | string[] | undefined>;
}
