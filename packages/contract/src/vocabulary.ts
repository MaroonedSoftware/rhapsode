/**
 * The standard cue and delivery vocabulary. protocol.md § 5.
 *
 * These are the words a client uses, and every adapter translates them into whatever its engine
 * actually has. They are declared here rather than in the `.ck` contract because § 9 requires that
 * nothing fail on an unrecognised cue: a closed enum on the wire would turn a worker built against
 * a newer vocabulary into a parse error, which is the opposite of the intended behaviour. The
 * closed set is a fact about this build of the core, not about the protocol.
 */

/**
 * Things a speaker does that are not words.
 *
 * They ride inside the text, written `[laugh]`, because a laugh happens at a place in a sentence
 * and a separate field would have to invent a way to say where.
 */
export const CUES = ['laugh', 'chuckle', 'sigh', 'gasp', 'cough', 'clear throat', 'sniff', 'groan'] as const;

export type Cue = (typeof CUES)[number];

/**
 * How a whole line is read.
 *
 * Two, and there is deliberately no word for "ordinary": a request with no delivery is the voice's
 * own reading, which is what nearly every line should be. A third word meaning "ordinary" would be
 * a second way to ask for nothing, and would key a second cache entry for identical audio.
 */
export const DELIVERIES = ['hushed', 'frantic'] as const;

export type Delivery = (typeof DELIVERIES)[number];

/** The contract major this build speaks. protocol.md § 9. */
export const CONTRACT_MAJOR = 1;

/**
 * A body under this many bytes is not audio, whatever the status said.
 *
 * A server answering `200` with a JSON complaint about an unknown voice produces a segment that
 * airs as a click, and the only place to notice is at the end of the stream. A real line is tens of
 * kilobytes.
 */
export const MIN_PLAUSIBLE_AUDIO_BYTES = 256;

/** The three environment variables a worker is spawned with, and nothing else. protocol.md § 2. */
export const WORKER_ENV = {
    listen: 'RHAPSODE_WORKER_LISTEN',
    engine: 'RHAPSODE_WORKER_ENGINE',
    contract: 'RHAPSODE_WORKER_CONTRACT',
} as const;
