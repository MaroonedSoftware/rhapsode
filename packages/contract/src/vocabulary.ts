/**
 * The standard cue and delivery vocabulary, and the rules that apply it. protocol.md § 5.
 *
 * A client asks for `[laugh]` and `hushed` in one set of words, and every adapter translates them
 * into whatever its engine actually has. These live here rather than in the `.ck` contract because
 * § 9 requires that nothing fail on an unrecognised cue: a closed enum on the wire would turn a
 * worker built against a newer vocabulary into a parse error, which is the opposite of the intended
 * behaviour. The closed set is a fact about this build of the core, not about the protocol.
 *
 * Everything here is a pure function with no I/O and no dependency on a server, so the shims and a
 * client SDK can apply exactly the same rules the core does.
 */

/**
 * Things a speaker does that are not words.
 *
 * They ride inside the text, written `[laugh]`, because a laugh happens at a place in a sentence and
 * a separate field would have to invent a way to say where.
 */
export const CUES = ['laugh', 'chuckle', 'sigh', 'gasp', 'cough', 'clear throat', 'sniff', 'groan'] as const;

/** One of {@link CUES}. */
export type Cue = (typeof CUES)[number];

/**
 * How a whole line is read.
 *
 * Two, and there is deliberately no word for "ordinary": a request with no delivery is the voice's
 * own reading, which is what nearly every line should be. A third word meaning "ordinary" would be a
 * second way to ask for nothing, and would key a second cache entry for identical audio.
 *
 * Widen this only when two engines can both perform the new word. One engine's feature is a `dial`.
 */
export const DELIVERIES = ['hushed', 'frantic'] as const;

/** One of {@link DELIVERIES}. */
export type Delivery = (typeof DELIVERIES)[number];

/** The contract major this build speaks. protocol.md § 9. */
export const CONTRACT_MAJOR = 1;

/**
 * A body under this many bytes is not audio, whatever the status said.
 *
 * A server answering `200` with a JSON complaint about an unknown voice produces a segment that airs
 * as a click, and the only place to notice is at the end of the stream. A real line is tens of
 * kilobytes.
 */
export const MIN_PLAUSIBLE_AUDIO_BYTES = 256;

/** The three environment variables a worker is spawned with, and nothing else. protocol.md § 2. */
export const WORKER_ENV = {
    listen: 'RHAPSODE_WORKER_LISTEN',
    engine: 'RHAPSODE_WORKER_ENGINE',
    contract: 'RHAPSODE_WORKER_CONTRACT',
} as const;

/**
 * A fresh matcher every call, because a `g` flag carries `lastIndex` between them.
 *
 * **Longest form first.** An alternation takes the earliest branch that matches at a position, so a
 * shorter cue that is a prefix of a longer one would claim it and leave the rest as text the engine
 * reads out loud. `clear throat` is the one that makes this load-bearing rather than tidy.
 */
const cuePattern = (): RegExp => new RegExp(`\\[(${[...CUES].sort((left, right) => right.length - left.length).join('|')})\\]`, 'gi');

/** Every cue written into a text, in the order they appear, with repeats. */
export function cuesIn(text: string): Cue[] {
    return [...text.matchAll(cuePattern())].map(match => match[1]!.toLowerCase() as Cue);
}

/**
 * The same text with cues removed, or with only some of them kept.
 *
 * `keep` is the set to **leave**, so the default of none is "take them all out": the safe direction,
 * and the one an engine that has never heard of a cue wants. The core strips every cue the effective
 * variant does not claim before dispatch, which means an engine that performs none never sees one,
 * and the failure where an engine reads the word "laugh" out loud cannot happen. Claiming a cue you
 * cannot perform is the only way to break that, which is what makes the honesty requirement on an
 * adapter exactly one line long.
 *
 * A removal closes the space it leaves behind, because `word [laugh] word` would otherwise render
 * with a double space that every consumer would have to know to tidy.
 *
 * Only the eight are touched. Anything else in brackets stays exactly as it arrived: § 9 says a
 * client must not fail on an unrecognised cue, and square brackets are ordinary punctuation in a
 * script. This is not a bracket stripper.
 */
export function withoutCues(text: string, keep: Iterable<string> = []): string {
    const kept = new Set<string>([...keep].map(cue => cue.toLowerCase()));

    return (
        text
            .replace(cuePattern(), (match, cue: string) => (kept.has(cue.toLowerCase()) ? match : ' '))
            .replace(/[^\S\n]{2,}/g, ' ')
            .replace(/[^\S\n]+([.,!?;:])/g, '$1')
            // A cue at the end of a line otherwise leaves a trailing space before the newline, which
            // the punctuation pass above does not reach. Multi-line text is far likelier here than in
            // a thirty-word radio break: a whole script arrives in one request.
            .replace(/[^\S\n]+\n/g, '\n')
            .trim()
    );
}
