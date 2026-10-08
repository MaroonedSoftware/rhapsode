import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildServer } from '../src/server.js';
import { RhapsodeJsonLogger } from '../src/logging/rhapsode.logger.js';
import { SpeakStreamSession } from '../src/speak/speak.stream.session.js';
import type { SpeakServices } from '../src/speak/speak.pipeline.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const canBindUnixSockets = await (async () => {
    const directory = mkdtempSync(join(tmpdir(), 'rh-probe-'));
    try {
        const server = createServer();
        await new Promise<void>((fulfil, fail) => {
            server.once('error', fail);
            server.listen(join(directory, 'p.sock'), fulfil);
        });
        await new Promise<void>(fulfil => server.close(() => fulfil()));
        return true;
    } catch {
        return false;
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
})();

const describeWithSockets = canBindUnixSockets ? describe : describe.skip;

let running: Awaited<ReturnType<typeof buildServer>> | undefined;
let socketDir: string | undefined;

afterEach(async () => {
    await running?.app.close();
    running = undefined;
    if (socketDir !== undefined) rmSync(socketDir, { recursive: true, force: true });
    socketDir = undefined;
});

async function listening(): Promise<string> {
    socketDir = mkdtempSync(join(tmpdir(), 'rh-'));
    const builder = await buildServer(
        { workers: { socketDir, startupTimeoutSeconds: 30 }, engines: { tone: { venv: join(REPO, 'python/.venv') } } },
        new RhapsodeJsonLogger('error', () => {}),
    );
    running = builder;
    const address = await builder.app.listen({ port: 0, host: '127.0.0.1' });
    return address.replace(/^http/, 'ws');
}

type Event = { type: string; [key: string]: unknown } | Buffer;

/** Open a session, send `frames`, and collect everything until the server closes it. */
async function converse(address: string, frames: object[]): Promise<{ events: Event[]; code: number }> {
    const socket = new WebSocket(`${address}/speak/stream`);
    socket.binaryType = 'arraybuffer';
    const events: Event[] = [];
    return new Promise((fulfil, fail) => {
        socket.addEventListener('open', () => frames.forEach(frame => socket.send(JSON.stringify(frame))));
        socket.addEventListener('message', message =>
            events.push(typeof message.data === 'string' ? JSON.parse(message.data) : Buffer.from(message.data as ArrayBuffer)),
        );
        socket.addEventListener('close', close => fulfil({ events, code: close.code }));
        socket.addEventListener('error', () => fail(new Error('the socket failed')));
    });
}

const framesOf = (events: Event[]) => events.filter((event): event is { type: string } => !Buffer.isBuffer(event));
const audioOf = (events: Event[]) => Buffer.concat(events.filter(event => Buffer.isBuffer(event)));

describeWithSockets('GET /speak/stream', () => {
    it('speaks each sentence once it is complete, the first on its own', async () => {
        const address = await listening();
        const { events, code } = await converse(address, [
            { type: 'start', engine: 'tone', seed: 1 },
            { type: 'text', text: 'The first sentence is here. The sec' },
            { type: 'text', text: 'ond one. And a third without a stop' },
            { type: 'end' },
        ]);

        const frames = framesOf(events);
        expect(frames[0]).toEqual({ type: 'ready', engine: 'tone', variant: 'plain' });
        expect(frames[1]).toEqual({ type: 'format', contentType: 'audio/L16; rate=24000; channels=1' });
        // The first sentence alone, the moment it is complete; then the rest, packed, at the end.
        const spoken = frames.filter(frame => frame.type === 'spoken');
        expect(spoken.map(frame => frame.characters)).toEqual([
            'The first sentence is here.'.length,
            'The second one. And a third without a stop'.length,
        ]);
        expect(spoken.map(frame => frame.index)).toEqual([0, 1]);
        expect(frames.at(-1)).toEqual({ type: 'done' });
        expect(code).toBe(1000);

        // Tone's audio is 60 ms a character, s16 at 24 kHz, so its length says what reached it.
        const characters = spoken.reduce((sum, frame) => sum + Number(frame.characters), 0);
        expect(audioOf(events).length).toBe(Math.round(characters * 0.06 * 24_000) * 2);
        for (const frame of spoken) expect(frame.durationMs).toBe(Math.round(Number(frame.characters) * 60));
    }, 60_000);

    it('reproduces itself from a seed when the text arrives in the same frames', async () => {
        const address = await listening();
        const frames = [{ type: 'start', engine: 'tone', seed: 7 }, { type: 'text', text: 'One sentence. Another one.' }, { type: 'end' }];
        const first = audioOf((await converse(address, frames)).events);
        const again = audioOf((await converse(address, frames)).events);
        expect(again.equals(first)).toBe(true);
    }, 60_000);

    it('speaks what has arrived on a flush, finished or not', async () => {
        const address = await listening();
        const { events } = await converse(address, [
            { type: 'start', engine: 'tone' },
            { type: 'text', text: 'no stop here' },
            { type: 'flush' },
            { type: 'end' },
        ]);
        expect(framesOf(events).filter(frame => frame.type === 'spoken')).toMatchObject([{ index: 0, characters: 'no stop here'.length }]);
    }, 60_000);

    it.each([
        [{ type: 'start', engine: 'nope' }, 'unknown_engine'],
        [{ type: 'start', engine: 'tone', format: 'wav' }, 'unsupported'],
        [{ type: 'start', engine: 'tone', params: { nope: 1 } }, 'bad_request'],
        [{ type: 'start', engine: 'tone', text: 'x' }, 'bad_request'],
        [{ type: 'start' }, 'bad_request'],
        [{ type: 'text', text: 'x' }, 'bad_request'],
    ])(
        'refuses %o before it is ready, as %s',
        async (start, code) => {
            const address = await listening();
            const { events, code: closed } = await converse(address, [start]);
            expect(framesOf(events)).toEqual([{ type: 'error', error: expect.objectContaining({ code }) }]);
            expect(closed).toBe(1011);
        },
        60_000,
    );

    it('ends the session on an unknown voice, found by the first piece', async () => {
        const address = await listening();
        const { events, code } = await converse(address, [
            { type: 'start', engine: 'tone', voice: 'nobody' },
            { type: 'text', text: 'Hello there. ' },
            { type: 'end' },
        ]);
        expect(framesOf(events)).toEqual([
            { type: 'ready', engine: 'tone', variant: 'plain' },
            { type: 'error', error: { code: 'unknown_voice', message: expect.any(String), retryable: false } },
        ]);
        expect(audioOf(events).length).toBe(0);
        expect(code).toBe(1011);
    }, 60_000);

    it('refuses a web page from elsewhere before the upgrade', async () => {
        await listening();
        const refused = await running!.app.inject({ method: 'GET', url: '/speak/stream', headers: { origin: 'https://evil.example' } });
        expect(refused.statusCode).toBe(403);
        expect(refused.json().error).toMatchObject({ code: 'forbidden' });
    }, 60_000);
});

/** Every promise the session has in flight run to where it waits on something outside it. */
const settled = async () => {
    for (let turn = 0; turn < 5; turn++) await new Promise(fulfil => setImmediate(fulfil));
};

/** A socket that records what the session sends, and a worker that speaks only when told to. */
function harness(idleMs = 60_000, acquireMs = 0) {
    const socket = Object.assign(new EventEmitter(), {
        OPEN: 1,
        readyState: 1,
        sent: [] as unknown[],
        closedWith: undefined as number | undefined,
        send(data: unknown, options?: unknown, done?: (error?: Error) => void) {
            this.sent.push(typeof data === 'string' ? JSON.parse(data) : data);
            (typeof options === 'function' ? options : done)?.();
        },
        close(code: number) {
            this.closedWith = code;
            this.readyState = 3;
        },
    });
    const release = vi.fn();
    const signals: AbortSignal[] = [];
    const client = {
        capabilities: async () => ({ variants: { plain: { cues: [], deliveries: [], dials: {} } }, current: undefined }),
        speak: (_body: unknown, signal: AbortSignal) => {
            signals.push(signal);
            return new Promise(() => {});
        },
    };
    const services = {
        engines: { has: () => true, ids: () => ['tone'], entry: () => ({ defaultVariant: 'plain' }) },
        workers: { client: async () => client },
        residency: {
            acquire: async () => {
                if (acquireMs > 0) await new Promise(fulfil => setTimeout(fulfil, acquireMs));
                return { release };
            },
        },
        logger: { error: () => {}, debug: () => {} },
    } as unknown as SpeakServices;
    const session = new SpeakStreamSession(socket as never, services, idleMs);
    const frame = async (value: object) => {
        socket.emit('message', Buffer.from(JSON.stringify(value)), false);
        await settled();
    };
    return { socket, session, frame, release, signals };
}

describe('SpeakStreamSession', () => {
    it('closes a session that sends nothing, and gives the model back', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        try {
            const { socket, frame, release } = harness(1_000);
            await frame({ type: 'start', engine: 'tone' });
            await vi.advanceTimersByTimeAsync(1_001);
            expect(socket.sent.at(-1)).toMatchObject({ type: 'error', error: { code: 'bad_request' } });
            expect(socket.closedWith).toBe(1011);
            expect(release).toHaveBeenCalledOnce();
        } finally {
            vi.useRealTimers();
        }
    });

    it('does not count time spent speaking as idle', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        try {
            const { socket, frame } = harness(1_000);
            await frame({ type: 'start', engine: 'tone' });
            await frame({ type: 'text', text: 'A sentence that never finishes speaking. ' });
            await vi.advanceTimersByTimeAsync(5_000);
            expect(socket.closedWith).toBeUndefined();
        } finally {
            vi.useRealTimers();
        }
    });

    it('stops the piece being spoken when the client goes, and gives the model back', async () => {
        const { socket, frame, release, signals } = harness();
        await frame({ type: 'start', engine: 'tone' });
        await frame({ type: 'text', text: 'A sentence. ' });
        expect(signals).toHaveLength(1);
        socket.emit('close');
        expect(signals[0]!.aborted).toBe(true);
        expect(release).toHaveBeenCalledOnce();
    });

    it('refuses a binary frame and a second start', async () => {
        for (const send of [
            (h: ReturnType<typeof harness>) => h.socket.emit('message', Buffer.from([1, 2, 3]), true),
            (h: ReturnType<typeof harness>) => h.frame({ type: 'start', engine: 'tone' }),
        ]) {
            const h = harness();
            await h.frame({ type: 'start', engine: 'tone' });
            await send(h);
            await settled();
            expect(h.socket.sent.at(-1)).toMatchObject({ type: 'error', error: { code: 'bad_request' } });
        }
    });

    it('releases a lease that arrives after the client has gone', async () => {
        // A load can take a minute, and the client may not wait for it.
        const { socket, frame, release } = harness(60_000, 20);
        await frame({ type: 'start', engine: 'tone' });
        socket.emit('close');
        await new Promise(fulfil => setTimeout(fulfil, 40));
        expect(release).toHaveBeenCalledOnce();
        expect(socket.sent).toEqual([]);
    });
});
