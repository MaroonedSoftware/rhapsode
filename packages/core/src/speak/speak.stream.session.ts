import { pipeline } from 'node:stream/promises';

import type { WebSocket } from '@fastify/websocket';

import { assertWithinCeiling, EngineSpeakRequest, performable, SentenceCutter, type Claims } from '@rhapsode/contract';

import { asRhapsodeError, RhapsodeError } from '../errors/rhapsode.error.js';
import type { ResidencyLease } from '../residency/residency.manager.js';
import { DURATION_HEADER, type WorkerClient } from '../workers/worker.client.js';
import { audioFloor } from './audio.floor.js';
import { DEFAULT_MAX_CHARACTERS, resolve, type SpeakServices } from './speak.pipeline.js';

/** `/speak`'s fields a `start` frame may carry: all of them but the text, which comes later, and `stream`. */
const FIELDS = Object.keys(EngineSpeakRequest.shape).filter(field => field !== 'text' && field !== 'stream');
const KEEP_ALIVE = EngineSpeakRequest.shape.keepAliveSeconds;

/**
 * How long a session may send nothing while nothing is being spoken. A client that vanished without
 * closing its socket would otherwise hold the residency lease, and so the model, for good. § 6.
 */
export const IDLE_MS = 60_000;

/** What `start` asked for, once it has been checked. */
interface Started {
    engineId: string;
    client: WorkerClient;
    variant: string;
    claims: Claims;
    limit: number;
    lease: ResidencyLease;
    voice?: string;
    language?: string;
    delivery?: string;
    params?: Record<string, number>;
    seed?: number;
}

/**
 * One `GET /speak/stream` conversation. protocol.md § 6, "Speaking as the text arrives".
 *
 * Frames are handled one after another, so a client that sends `start` and its first text together
 * has the text wait for the engine to resolve rather than race it. Speaking runs beside that, one
 * piece at a time, and takes whatever the cutter has ready whenever the worker is free.
 */
export class SpeakStreamSession {
    #frames: Promise<void> = Promise.resolve();
    #started?: Started;
    #cutter?: SentenceCutter;
    #queued: string[] = [];
    #index = 0;
    #speaking = false;
    #ending = false;
    #closed = false;
    #formatSent = false;
    #idle?: NodeJS.Timeout;
    readonly #abort = new AbortController();

    constructor(
        private readonly socket: WebSocket,
        private readonly services: SpeakServices,
        private readonly idleMs = IDLE_MS,
    ) {
        socket.on('message', (data, isBinary) => {
            this.#frames = this.#frames.then(() => this.#frame(data, isBinary)).catch(error => this.#fail(error));
        });
        socket.on('close', () => this.#close());
        socket.on('error', () => this.#close());
        this.#arm();
    }

    async #frame(data: unknown, isBinary: boolean): Promise<void> {
        if (this.#closed) return;
        this.#arm();
        if (isBinary) throw new RhapsodeError('bad_request', 'frames are JSON text; binary frames are only ever audio from the server');

        let frame: Record<string, unknown>;
        try {
            frame = JSON.parse(String(data)) as Record<string, unknown>;
        } catch {
            throw new RhapsodeError('bad_request', 'a frame is one JSON object');
        }
        if (frame === null || typeof frame !== 'object') throw new RhapsodeError('bad_request', 'a frame is one JSON object');

        if (this.#started === undefined) {
            if (frame.type !== 'start') throw new RhapsodeError('bad_request', 'the first frame is `{ "type": "start", "engine": … }`');
            await this.#start(frame);
            return;
        }

        switch (frame.type) {
            case 'text':
                if (typeof frame.text !== 'string') throw new RhapsodeError('bad_request', '`text` frames carry a string `text`');
                this.#cutter!.push(frame.text);
                break;
            case 'flush':
                this.#queued.push(...this.#cutter!.rest());
                break;
            case 'end':
                this.#queued.push(...this.#cutter!.rest());
                this.#ending = true;
                break;
            case 'start':
                throw new RhapsodeError('bad_request', 'this session has started; one `start` per socket');
            default:
                throw new RhapsodeError('bad_request', `no frame type "${String(frame.type)}"; a client sends start, text, flush and end`);
        }
        this.#pump();
    }

    /** Everything `/speak` would refuse before audio, refused here before `ready`. */
    async #start(frame: Record<string, unknown>): Promise<void> {
        const unknown = Object.keys(frame).find(key => key !== 'type' && !FIELDS.includes(key));
        if (unknown !== undefined) {
            throw new RhapsodeError('bad_request', `no field "${unknown}"; start takes ${[...FIELDS].sort().join(', ')}`);
        }
        if (typeof frame.engine !== 'string') throw new RhapsodeError('bad_request', '`engine` is required');
        if (frame.format !== undefined && frame.format !== 'pcm') {
            throw new RhapsodeError('unsupported', `/speak/stream speaks pcm, which joins piece to piece; not "${String(frame.format)}"`);
        }
        const keepAlive = KEEP_ALIVE.safeParse(frame.keepAliveSeconds);
        if (!keepAlive.success) throw new RhapsodeError('bad_request', `\`keepAliveSeconds\`: ${keepAlive.error.issues[0]!.message}`);

        const string = (value: unknown) => (typeof value === 'string' ? value : undefined);
        const { engineId, client, variant, claims } = await resolve(this.services, frame.engine, string(frame.variant));
        const params = frame.params as Record<string, number> | undefined;
        // An unknown dial now, rather than at the first full stop. The text is a placeholder.
        performable({ text: '-', delivery: string(frame.delivery), params }, claims, variant);

        const declared = (claims as { segmentation?: { segmentCharacters?: number } }).segmentation?.segmentCharacters;
        const limit = declared ?? claims.maxCharacters ?? DEFAULT_MAX_CHARACTERS;
        const lease = await this.services.residency.acquire(engineId, variant, { keepAliveSeconds: keepAlive.data });
        if (this.#closed) {
            lease.release();
            return;
        }

        this.#started = {
            engineId,
            client,
            variant,
            claims,
            limit,
            lease,
            voice: string(frame.voice),
            language: string(frame.language),
            delivery: string(frame.delivery),
            params,
            seed: typeof frame.seed === 'number' ? frame.seed : undefined,
        };
        this.#cutter = new SentenceCutter(limit);
        this.#send({ type: 'ready', engine: engineId, variant });
    }

    /** Speak the next piece if the worker is free and one is ready, and end once nothing is left. */
    #pump(): void {
        if (this.#speaking || this.#closed || this.#started === undefined) return;
        const piece = this.#queued.shift() ?? this.#cutter!.next();
        if (piece === undefined) {
            if (this.#ending) {
                this.#send({ type: 'done' });
                this.socket.close(1000);
                this.#close();
            }
            return;
        }
        this.#speaking = true;
        this.#speak(piece)
            .then(() => {
                this.#speaking = false;
                this.#arm();
                this.#pump();
            })
            .catch(error => this.#fail(error));
    }

    /** One piece through `/speak`'s rules and the worker's `/speak`, its audio onto the socket. */
    async #speak(piece: string): Promise<void> {
        const started = this.#started!;
        const index = this.#index++;
        assertWithinCeiling(piece, started.claims, DEFAULT_MAX_CHARACTERS);
        const ready = performable({ text: piece, delivery: started.delivery, params: started.params }, started.claims, started.variant);
        // A piece that was nothing but cues the variant does not claim has nothing left to say.
        if (ready.text.length === 0) return;

        const upstream = await started.client.speak(
            {
                text: ready.text,
                variant: started.variant,
                format: 'pcm',
                language: started.language,
                voice: started.voice,
                delivery: ready.delivery,
                params: ready.params,
                seed: started.seed === undefined ? undefined : started.seed + index,
                stream: true,
            },
            this.#abort.signal,
        );
        if (!this.#formatSent) {
            // The worker's Content-Type, verbatim: § 6 makes it authoritative, and the core holds no
            // format table, so the rate is known only once a worker has answered.
            this.#send({ type: 'format', contentType: upstream.contentType });
            this.#formatSent = true;
        }

        const socket = this.socket;
        await pipeline(upstream.body, audioFloor(), async (audio: AsyncIterable<Buffer>) => {
            for await (const chunk of audio) {
                // Waiting for each frame to be written is the backpressure: a client reading slowly
                // slows the worker, rather than the core buffering its audio.
                await new Promise<void>((fulfil, fail) => socket.send(chunk, { binary: true }, error => (error ? fail(error) : fulfil())));
            }
        });

        const duration = upstream.trailers()[DURATION_HEADER] ?? upstream.durationMs;
        this.#send({
            type: 'spoken',
            index,
            characters: piece.length,
            ...(typeof duration === 'string' ? { durationMs: Number(duration) } : {}),
        });
    }

    /** Every error ends the session, in `/speak`'s envelope. */
    #fail(error: unknown): void {
        if (this.#closed) return;
        const failure = asRhapsodeError(error);
        if (failure.code === 'internal') {
            this.services.logger.error('a streamed session failed', { engine: this.#started?.engineId, error });
        }
        this.#send({ type: 'error', ...failure.envelope() });
        this.socket.close(1011);
        this.#close();
    }

    #send(frame: Record<string, unknown>): void {
        if (!this.#closed && this.socket.readyState === this.socket.OPEN) this.socket.send(JSON.stringify(frame));
    }

    /** Reset the idle clock. It fires only while nothing is being spoken. */
    #arm(): void {
        clearTimeout(this.#idle);
        if (this.#closed) return;
        this.#idle = setTimeout(() => {
            if (this.#speaking) return this.#arm();
            this.#fail(new RhapsodeError('bad_request', `nothing arrived for ${this.idleMs / 1000} s, so this session is closed`));
        }, this.idleMs);
    }

    /** However it ends: stop the piece being spoken, give the model back, and stop the clock. */
    #close(): void {
        if (this.#closed) return;
        this.#closed = true;
        clearTimeout(this.#idle);
        this.#abort.abort();
        this.#started?.lease.release();
    }
}
