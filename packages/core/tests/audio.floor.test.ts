import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { describe, expect, it } from 'vitest';

import { audioFloor, ShortAudioError } from '../src/speak/audio.floor.js';

async function through(chunks: Buffer[]): Promise<Buffer> {
    const collected: Buffer[] = [];
    await pipeline(Readable.from(chunks), audioFloor(), async source => {
        for await (const chunk of source) collected.push(chunk as Buffer);
    });
    return Buffer.concat(collected);
}

describe('the 256-byte floor', () => {
    it('passes a plausible body through untouched', async () => {
        const body = Buffer.alloc(4096, 7);
        expect(await through([body])).toEqual(body);
    });

    it('fails at the end, not on the first chunk', async () => {
        // A short error body can arrive in several pieces, and "was any of this plausibly audio" is
        // only answerable once it stops. Ten 10-byte chunks are individually tiny and collectively
        // still not audio.
        await expect(through(Array.from({ length: 10 }, () => Buffer.alloc(10)))).rejects.toThrow(ShortAudioError);
    });

    it('accepts a body assembled from many small pieces', async () => {
        const pieces = Array.from({ length: 40 }, () => Buffer.alloc(10, 3));
        expect((await through(pieces)).length).toBe(400);
    });

    it('names the byte count it saw', async () => {
        await expect(through([Buffer.alloc(16)])).rejects.toThrow(/returned 16 bytes/);
    });

    it('buffers nothing, which is what lets it coexist with streaming', async () => {
        // The only state is an integer. If it buffered, a five-minute synthesis would be held in
        // memory before a byte reached the client.
        const seen: number[] = [];
        await pipeline(Readable.from([Buffer.alloc(200, 1), Buffer.alloc(200, 2)]), audioFloor(), async source => {
            for await (const chunk of source) seen.push((chunk as Buffer).length);
        });
        expect(seen).toEqual([200, 200]);
    });
});
