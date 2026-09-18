import { describe, expect, it } from 'vitest';

import { CUES, cuesIn, DELIVERIES, withoutCues } from '../src/vocabulary.js';

describe('the standard vocabulary', () => {
    it('is the eight cues and the two deliveries', () => {
        expect(CUES).toEqual(['laugh', 'chuckle', 'sigh', 'gasp', 'cough', 'clear throat', 'sniff', 'groan']);
        expect(DELIVERIES).toEqual(['hushed', 'frantic']);
    });
});

describe('withoutCues', () => {
    it('closes the space a removal leaves behind', () => {
        // Otherwise every consumer has to know to tidy a double space it did not create.
        expect(withoutCues('word [laugh] word')).toBe('word word');
    });

    it('matches the longest cue first', () => {
        // An alternation takes the earliest branch that matches, so a shorter cue that is a prefix
        // of a longer one would claim it and leave "throat" as text the engine reads out loud.
        expect(withoutCues('Right [clear throat] then.')).toBe('Right then.');
        expect(withoutCues('Right [clear throat] then.', ['clear throat'])).toBe('Right [clear throat] then.');
    });

    it('does not leave a space before punctuation', () => {
        expect(withoutCues('a [laugh], b [sigh]. c')).toBe('a, b. c');
    });

    it('does not leave a space before a newline', () => {
        // A whole script arrives in one request here, so multi-line text is the common case rather
        // than the exception it was in a thirty-word radio break.
        expect(withoutCues('line one [laugh]\nline two')).toBe('line one\nline two');
    });

    it('keeps only what it was told to keep', () => {
        expect(withoutCues('a [laugh] b [sigh] c', ['laugh'])).toBe('a [laugh] b c');
    });

    it('is case insensitive', () => {
        expect(withoutCues('a [LAUGH] b')).toBe('a b');
    });

    it('leaves brackets it does not recognise exactly as they arrived', () => {
        // Section 9 says a client must not fail on an unrecognised cue, and square brackets are
        // ordinary punctuation in a script. This is not a bracket stripper.
        expect(withoutCues('see [1] and [S1] and [wibble]')).toBe('see [1] and [S1] and [wibble]');
    });

    it('takes them all out by default', () => {
        // The safe direction, and the one an engine that has never heard of a cue wants.
        expect(withoutCues('a [laugh] b [groan] c')).toBe('a b c');
    });

    it('survives being called twice', () => {
        // A `g` flag carries lastIndex between calls, which is why the matcher is built fresh.
        const text = 'a [laugh] b';
        expect(withoutCues(text)).toBe(withoutCues(text));
    });
});

describe('cuesIn', () => {
    it('reports them in order, with repeats', () => {
        expect(cuesIn('a [laugh] b [sigh] c [laugh]')).toEqual(['laugh', 'sigh', 'laugh']);
    });

    it('reports nothing for text with no cues', () => {
        expect(cuesIn('an ordinary line')).toEqual([]);
    });
});
