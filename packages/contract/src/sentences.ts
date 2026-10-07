/**
 * Breaking text where a reader would pause, in TypeScript. protocol.md § 6 and § 8.
 *
 * This is the worker SDK's `rhapsode_worker.text`, line for line, for the one place the core has to
 * find sentence ends itself: `/speak/stream`, which speaks text as a model writes it and so has to
 * decide where a sentence is complete before a worker sees any of it. Two copies of one rule drift
 * quietly, which is how the SDK came to own the Python one (§ 8), so both are tested against the same
 * cases in `contracts/fixtures/segments.json`, and a change to either fails the other's suite until
 * it is made to both.
 */

/**
 * Han, kana and the CJK punctuation and fullwidth forms: the scripts written without spaces. Hangul
 * is left out, because Korean spaces its words and gluing two Hangul pieces would fuse two words.
 */
const CJK = '　-〿぀-ヿ㐀-䶿一-鿿豈-﫿＀-￯\u{20000}-\u{3ffff}';

/** What may follow a full stop and still belong to its sentence: `他说：「好。」` ends after the `」`. */
const CLOSE = '」』）〕》〉”’';

/**
 * Where one sentence ends and the next begins: a Latin stop with whitespace after it, or a CJK stop
 * with none needed, but not between two stops or before a closing bracket. The SDK's `SENTENCE_END`.
 */
const SENTENCE_END = new RegExp(
    `(?<=[.!?…])\\s+|(?<=[。！？])(?![${CLOSE}。！？…])\\s*|(?<=[。！？…][${CLOSE}])(?![${CLOSE}])\\s*|(?<=…)(?=[${CJK}])`,
    'gu',
);

/** Where a reader pauses inside a sentence, used only when a whole sentence will not fit. */
const CLAUSE_END = /(?<=[,;:])\s+|(?<=[，、；：])\s*/gu;

/** A run of non-space characters, in which a bracketed cue counts as one character. */
const WORD = /(?:\[[^[\]]*\]|[^\s[])+|\S/gu;

/** The units a CJK run with no break point is cut into: a cue, a non-CJK run, or one character and its punctuation. */
const UNIT = new RegExp(`\\[[^[\\]]*\\]|[^\\s[${CJK}]+|.[。！？，、；：…${CLOSE}]*`, 'gu');

const IS_CJK = new RegExp(`[${CJK}]`, 'u');

/** The text split at every sentence end, as the SDK's `SENTENCE_END.split` splits it. */
export function sentences(text: string): string[] {
    return text.trim().split(SENTENCE_END);
}

/**
 * Text in pieces of at most `limit` characters, broken where a reader would pause. The SDK's
 * `segments`: sentences first, then clauses, then words, packed back greedily. A word longer than
 * the limit stays whole, except a run of CJK, which is cut at the limit.
 */
export function segments(text: string, limit: number): string[] {
    const pieces = sentences(text).flatMap(sentence => fit(sentence, limit));
    return pack(
        pieces.filter(piece => piece.length > 0),
        limit,
    );
}

function fit(sentence: string, limit: number): string[] {
    if (length(sentence) <= limit) return [sentence];
    const clauses = sentence.split(CLAUSE_END).filter(clause => clause.length > 0);
    if (clauses.length > 1) return clauses.flatMap(clause => fit(clause, limit));
    return pack(
        [...sentence.matchAll(WORD)].flatMap(match => cut(match[0], limit)),
        limit,
    );
}

function cut(word: string, limit: number): string[] {
    if (length(word) <= limit || !IS_CJK.test(word)) return [word];
    return pack(
        [...word.matchAll(UNIT)].map(match => match[0]),
        limit,
        () => '',
    );
}

function pack(pieces: string[], limit: number, between: (left: string, right: string) => string = joint): string[] {
    const packed: string[] = [];
    let current = '';
    for (const piece of pieces) {
        const gap = between(current, piece);
        if (current && length(current) + length(gap) + length(piece) > limit) {
            packed.push(current);
            current = piece;
        } else {
            current = current ? `${current}${gap}${piece}` : piece;
        }
    }
    if (current) packed.push(current);
    return packed;
}

/** Nothing between two CJK characters, which is where the text had nothing; a space otherwise. */
function joint(left: string, right: string): string {
    const last = [...left].at(-1);
    const first = [...right][0];
    return last !== undefined && first !== undefined && IS_CJK.test(last) && IS_CJK.test(first) ? '' : ' ';
}

/**
 * Characters as Python counts them, by code point. JavaScript's `length` counts UTF-16 units, and a
 * Han character beyond the basic plane is two of those and one of Python's, which put the two
 * splitters' pieces in different places.
 */
function length(text: string): number {
    let count = 0;
    for (const _ of text) count++;
    return count;
}

/**
 * Sentences as they finish, from text that arrives a little at a time. protocol.md § 6.
 *
 * `next` answers with a piece once one is ready: the first sentence on its own, so the first audio
 * waits for one sentence, and after that every sentence complete so far, packed up to `limit`. A stop
 * at the very end of what has arrived is not a sentence end yet, because `3.` may be about to become
 * `3.5`. Text with no sentence end at all is cut at a clause or word once it passes `limit`, so a
 * model that never writes a full stop is still heard. `rest` is everything left, for a `flush`.
 */
export class SentenceCutter {
    #text = '';
    #first = true;

    constructor(readonly limit: number) {}

    push(text: string): void {
        this.#text += text;
    }

    /** The next piece ready to speak, or undefined until more text arrives. */
    next(): string | undefined {
        const text = this.#text;
        const ends = [...text.matchAll(SENTENCE_END)].filter(match => match.index < text.length && match.index > 0);

        if (ends.length > 0) {
            const fitting = ends.filter(match => length(text.slice(0, match.index).trim()) <= this.limit);
            const chosen = this.#first || fitting.length === 0 ? ends[0]! : fitting.at(-1)!;
            const sentence = text.slice(0, chosen.index).trim();
            if (length(sentence) <= this.limit) {
                this.#consume(chosen.index + chosen[0].length);
                return sentence;
            }
            return this.#cutFrom(text.slice(0, chosen.index));
        }

        if (length(text.trim()) <= this.limit) return undefined;
        return this.#cutFrom(text);
    }

    /** Everything that has arrived and not been taken, in pieces within the limit. */
    rest(): string[] {
        const pieces = segments(this.#text, this.limit).filter(piece => piece.trim().length > 0);
        this.#text = '';
        this.#first = false;
        return pieces;
    }

    /**
     * The first piece of an over-long head, taken from the front of the text. Only once there is a
     * piece after it, so the last word of what has arrived, which may be half a word, is never sent.
     */
    #cutFrom(head: string): string | undefined {
        const pieces = segments(head, this.limit);
        if (pieces.length < 2) return undefined;
        const piece = pieces[0]!;
        this.#consume(offsetAfter(this.#text, piece));
        return piece;
    }

    #consume(end: number): void {
        this.#text = this.#text.slice(end);
        this.#first = false;
    }
}

/**
 * Where `piece` ends in `text`, counting only what is not whitespace. A piece is the text's own
 * characters with only the whitespace at its joints changed, so this is exact.
 */
function offsetAfter(text: string, piece: string): number {
    let wanted = piece.replace(/\s/gu, '').length;
    let index = 0;
    while (wanted > 0 && index < text.length) {
        if (!/\s/u.test(text[index]!)) wanted--;
        index++;
    }
    return index;
}
