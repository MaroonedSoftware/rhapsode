/**
 * `GET /speak/stream`: text in as a language model writes it, audio out a sentence at a time.
 * protocol.md § 6, "Speaking as the text arrives".
 *
 * Written by hand, because the route is a WebSocket conversation and ContractKit describes requests
 * and responses. It uses the platform's own `WebSocket`, which browsers and Node 22 both have, so the
 * package still depends on nothing.
 */

/** `/speak`'s fields without the text, which comes later, and `stream`. */
export interface SpeakStreamStart {
    engine: string;
    voice?: string;
    variant?: string;
    /** `pcm` is the only format a stream speaks, because pieces join by concatenation. */
    format?: 'pcm';
    language?: string;
    delivery?: string;
    params?: Record<string, number>;
    seed?: number;
    keepAliveSeconds?: number;
}

/** What the server says, in order, until it is done. */
export type SpeakStreamEvent =
    | { type: 'ready'; engine: string; variant: string }
    /** Once, before the first audio: the worker's `Content-Type`, which carries the rate. */
    | { type: 'format'; contentType: string }
    | { type: 'audio'; data: Uint8Array }
    /** After each piece's audio. */
    | { type: 'spoken'; index: number; characters: number; durationMs?: number };

/** The protocol's error envelope, thrown from the events, which end with it. § 6. */
export class SpeakStreamError extends Error {
    constructor(
        readonly code: string,
        message: string,
        readonly retryable: boolean,
    ) {
        super(message);
        this.name = 'SpeakStreamError';
    }
}

export interface SpeakStream {
    /** Add text, in whatever pieces it arrives in. */
    push(text: string): void;
    /** Speak what has arrived, finished or not. */
    flush(): void;
    /** Speak what is left, then finish. The events end once it has all been spoken. */
    end(): void;
    /** Stop now: the piece being spoken stops and nothing more is said. */
    close(): void;
    /** Everything the server says, ending at `done` and throwing a `SpeakStreamError` on an error. */
    events: AsyncIterable<SpeakStreamEvent>;
}

/**
 * Open a session. Frames sent before the socket opens are kept and sent once it does, so a caller can
 * start pushing text at once.
 *
 * @example
 * ```ts
 * const stream = speakStream('http://localhost:8080', { engine: 'kokoro', voice: 'af_bella' });
 * for await (const token of model.answer(question)) stream.push(token);
 * stream.end();
 * for await (const event of stream.events) if (event.type === 'audio') player.write(event.data);
 * ```
 */
export function speakStream(baseUrl: string, start: SpeakStreamStart): SpeakStream {
    const socket = new WebSocket(`${baseUrl.replace(/^http/, 'ws').replace(/\/$/, '')}/speak/stream`);
    socket.binaryType = 'arraybuffer';

    const pending: string[] = [JSON.stringify({ type: 'start', ...start })];
    const send = (frame: object) => {
        const text = JSON.stringify(frame);
        if (socket.readyState === WebSocket.OPEN) socket.send(text);
        else pending.push(text);
    };
    socket.addEventListener('open', () => pending.splice(0).forEach(text => socket.send(text)));

    const events = new Inbox<SpeakStreamEvent>();
    socket.addEventListener('message', message => {
        if (typeof message.data !== 'string') {
            events.put({ type: 'audio', data: new Uint8Array(message.data as ArrayBuffer) });
            return;
        }
        const frame = JSON.parse(message.data) as { type: string; error?: { code: string; message: string; retryable: boolean } };
        if (frame.type === 'done') events.finish();
        else if (frame.type === 'error' && frame.error)
            events.fail(new SpeakStreamError(frame.error.code, frame.error.message, frame.error.retryable));
        else events.put(frame as SpeakStreamEvent);
    });
    socket.addEventListener('close', close => {
        events.fail(new SpeakStreamError('internal', `the server closed the session (${close.code}) before it was done`, true));
    });
    socket.addEventListener('error', () => {
        events.fail(new SpeakStreamError('internal', 'the session could not be opened or failed', true));
    });

    return {
        push: text => send({ type: 'text', text }),
        flush: () => send({ type: 'flush' }),
        end: () => send({ type: 'end' }),
        close: () => {
            events.finish();
            socket.close();
        },
        events,
    };
}

/** A queue read with `for await`, ending at `finish` or throwing at `fail`. The first ending wins. */
class Inbox<T> implements AsyncIterable<T> {
    #items: T[] = [];
    #ended?: { error?: Error };
    #wake?: () => void;

    put(item: T): void {
        if (this.#ended) return;
        this.#items.push(item);
        this.#wake?.();
    }

    finish(): void {
        this.#ended ??= {};
        this.#wake?.();
    }

    fail(error: Error): void {
        this.#ended ??= { error };
        this.#wake?.();
    }

    async *[Symbol.asyncIterator](): AsyncIterator<T> {
        for (;;) {
            if (this.#items.length > 0) {
                yield this.#items.shift()!;
                continue;
            }
            if (this.#ended) {
                if (this.#ended.error) throw this.#ended.error;
                return;
            }
            await new Promise<void>(wake => (this.#wake = wake));
            this.#wake = undefined;
        }
    }
}
