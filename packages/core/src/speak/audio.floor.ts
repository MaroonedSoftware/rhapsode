import { Transform } from 'node:stream';

import { MIN_PLAUSIBLE_AUDIO_BYTES } from '@rhapsode/contract';

/** Raised at the end of a stream that never carried enough bytes to be audio. */
export class ShortAudioError extends Error {
    constructor(readonly delivered: number) {
        super(`the worker returned ${delivered} bytes, which is not audio`);
        this.name = 'ShortAudioError';
    }
}

/**
 * Count the bytes and fail at the end if there were not enough. protocol.md § 6.
 *
 * This exists because a server answering `200` with a JSON complaint about an unknown voice
 * produces a segment that airs as a click, and the only place to notice is at the end of the
 * stream. The check belongs at the end rather than on the first chunk, because a short error body
 * can arrive in several pieces and "was any of this plausibly audio" is only answerable once it
 * stops.
 *
 * It buffers nothing: every chunk is forwarded as it arrives and the only state is an integer,
 * which is what lets it coexist with streaming through. Bytes already sent are already on the wire,
 * and that is exactly why the failure is an abort rather than a status.
 */
export const audioFloor = (floor = MIN_PLAUSIBLE_AUDIO_BYTES): Transform => {
    let delivered = 0;

    return new Transform({
        transform(chunk: Buffer, _encoding, done) {
            delivered += chunk.length;
            done(undefined, chunk);
        },
        flush(done) {
            done(delivered >= floor ? undefined : new ShortAudioError(delivered));
        },
    });
};
