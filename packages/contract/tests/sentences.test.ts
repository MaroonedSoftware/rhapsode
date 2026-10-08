import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { SentenceCutter, segments, sentences } from '../src/sentences.js';

interface Case {
    text: string;
    limit: number;
    sentences: string[];
    segments: string[];
}

// Generated from the SDK's splitter, which is the source of truth. protocol.md § 8.
const fixture = JSON.parse(readFileSync(fileURLToPath(new URL('../../../contracts/fixtures/segments.json', import.meta.url)), 'utf8')) as {
    cases: Case[];
};

describe('the splitter, against the SDK', () => {
    it.each(fixture.cases)('splits $text at $limit as the SDK does', ({ text, limit, sentences: expected, segments: pieces }) => {
        expect(sentences(text).filter(sentence => sentence.length > 0)).toEqual(expected);
        expect(segments(text, limit)).toEqual(pieces);
    });
});

/** Feed `text` in frames of `size` characters, taking every piece that is ready after each. */
function stream(text: string, size: number, limit = 300): string[] {
    const cutter = new SentenceCutter(limit);
    const spoken: string[] = [];
    for (let index = 0; index < text.length; index += size) {
        cutter.push(text.slice(index, index + size));
        for (let piece = cutter.next(); piece !== undefined; piece = cutter.next()) spoken.push(piece);
    }
    return [...spoken, ...cutter.rest()];
}

describe('SentenceCutter', () => {
    it('speaks the first sentence as soon as it is complete', () => {
        const cutter = new SentenceCutter(300);
        cutter.push('The quick brown fox jumps over the lazy dog.');
        expect(cutter.next()).toBeUndefined();
        cutter.push(' And then');
        expect(cutter.next()).toBe('The quick brown fox jumps over the lazy dog.');
        expect(cutter.next()).toBeUndefined();
        expect(cutter.rest()).toEqual(['And then']);
    });

    it('packs every sentence complete since, after the first', () => {
        const cutter = new SentenceCutter(300);
        cutter.push('One. Two. Three. Four. Fi');
        expect(cutter.next()).toBe('One.');
        expect(cutter.next()).toBe('Two. Three. Four.');
        expect(cutter.next()).toBeUndefined();
    });

    it('packs only up to the limit', () => {
        const cutter = new SentenceCutter(12);
        cutter.push('One. Two words. Three more. And');
        expect(cutter.next()).toBe('One.');
        expect(cutter.next()).toBe('Two words.');
        expect(cutter.next()).toBe('Three more.');
        expect(cutter.next()).toBeUndefined();
    });

    it('waits on a stop at the end of what has arrived, which may be a decimal point', () => {
        const cutter = new SentenceCutter(300);
        cutter.push('It costs 3.');
        expect(cutter.next()).toBeUndefined();
        cutter.push('5 dollars. Then');
        expect(cutter.next()).toBe('It costs 3.5 dollars.');
    });

    it('finds a CJK stop with no space after it, once the next character arrives', () => {
        const cutter = new SentenceCutter(300);
        cutter.push('今天天气很好。');
        expect(cutter.next()).toBeUndefined();
        cutter.push('我们');
        expect(cutter.next()).toBe('今天天气很好。');
    });

    it('keeps a closing bracket with the stop before it', () => {
        const cutter = new SentenceCutter(300);
        cutter.push('他说：「好。');
        cutter.push('」然后');
        expect(cutter.next()).toBe('他说：「好。」');
    });

    it('cuts text with no sentence end once it passes the limit, never sending half a word', () => {
        const cutter = new SentenceCutter(20);
        cutter.push('alpha bravo charlie delta echo fox');
        expect(cutter.next()).toBe('alpha bravo charlie');
        expect(cutter.next()).toBeUndefined();
        expect(cutter.rest()).toEqual(['delta echo fox']);
    });

    it('cuts an over-long sentence at its clauses', () => {
        const cutter = new SentenceCutter(30);
        cutter.push('It went on, and on, and on, and on, and on, and on, and then it stopped. Next');
        const pieces = [cutter.next(), cutter.next(), cutter.next()];
        expect(pieces).toEqual(['It went on, and on, and on,', 'and on, and on, and on,', 'and then it stopped.']);
    });

    it('loses nothing and adds nothing, however the text is framed', () => {
        const text = 'One two three. Four five six! Seven? Eight… nine, ten; eleven: twelve. 今天天气很好。我们走吧！Done.';
        const squash = (pieces: string[]) => pieces.join('').replace(/\s/gu, '');
        for (const size of [1, 2, 3, 7, 50, text.length]) {
            expect(squash(stream(text, size))).toBe(text.replace(/\s/gu, ''));
        }
    });

    it('never makes a piece over the limit, unless it is one word', () => {
        const text = 'Sentence number one says something. '.repeat(30) + 'Supercalifragilisticexpialidocious.';
        for (const piece of stream(text, 5, 40)) {
            expect(piece.length <= 40 || !piece.includes(' ')).toBe(true);
        }
    });

    it('has nothing left once everything is taken', () => {
        const cutter = new SentenceCutter(300);
        cutter.push('Done. ');
        expect(cutter.next()).toBe('Done.');
        expect(cutter.rest()).toEqual([]);
    });
});
