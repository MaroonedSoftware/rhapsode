import type { FeedEvent } from '@rhapsode/sdk';

/**
 * An EventSource that a test drives. jsdom has none, and a real one would need a server.
 *
 * Every instance is kept, so a test can find the stream the page opened and push frames into it the
 * way the core would: named `server.feed`, data a JSON feed event.
 */
export class FakeEventSource {
    static opened: FakeEventSource[] = [];

    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    closed = false;
    private readonly listeners = new Map<string, ((message: MessageEvent<string>) => void)[]>();
    private nextId = 1;

    constructor(readonly url: string) {
        FakeEventSource.opened.push(this);
    }

    addEventListener(type: string, listener: (message: MessageEvent<string>) => void): void {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }

    close(): void {
        this.closed = true;
    }

    /** One feed event, as the core frames it. */
    emit(event: Omit<FeedEvent, 'id' | 'ts' | 'source' | 'level'> & Partial<FeedEvent>): void {
        const full: FeedEvent = { id: this.nextId++, ts: '2026-09-18T12:00:00.000Z', source: 'install', level: 'info', ...event };
        for (const listener of this.listeners.get('server.feed') ?? []) listener(new MessageEvent('server.feed', { data: JSON.stringify(full) }));
    }

    static latest(): FakeEventSource {
        const source = FakeEventSource.opened.at(-1);
        if (source === undefined) throw new Error('the page opened no event stream');
        return source;
    }

    static install(): void {
        FakeEventSource.opened = [];
        (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
    }
}
