import { describe, expect, it } from 'vitest';

import { assertKnownDials, assertWithinCeiling, DispatchError, effectiveVariant, performable, performableDialogue } from '../src/dispatch.js';
import type { Claims } from '../src/dispatch.js';

const turbo: Claims = { cues: ['laugh', 'sigh'], deliveries: [], dials: {} };
const original: Claims = {
    cues: [],
    deliveries: ['hushed', 'frantic'],
    dials: {
        exaggeration: { min: 0, max: 2, default: 0.5 },
        cfgWeight: { min: 0, max: 1, default: 0.5 },
    },
};

const declared = { turbo: { ...turbo }, original: { ...original } } as never;

describe('effectiveVariant', () => {
    it('takes the one the request named', () => {
        expect(effectiveVariant('original', declared, { loaded: 'turbo' })).toBe('original');
    });

    it('refuses a variant the engine does not have rather than swapping one in', () => {
        // A fallback here produces audio the caller did not ask for and has no way to notice.
        expect(() => effectiveVariant('nosuch', declared)).toThrow(DispatchError);
        expect(() => effectiveVariant('nosuch', declared)).toThrow(/no variant "nosuch"/);
    });

    it('falls back to what is loaded when the request said nothing', () => {
        expect(effectiveVariant(undefined, declared, { loaded: 'original' })).toBe('original');
    });

    it('falls back to the default when nothing is loaded', () => {
        expect(effectiveVariant(undefined, declared, { fallback: 'original' })).toBe('original');
    });

    it('falls back to the first declared variant when there is nothing else to go on', () => {
        // Total by construction, which `current` is not: it is absent while nothing is resident.
        expect(effectiveVariant(undefined, declared)).toBe('turbo');
    });
});

describe('assertKnownDials', () => {
    it('refuses an unknown key and says what the variant does have', () => {
        // A bug report delivered to the right person in under a second is only true if the message
        // says what to send instead.
        expect(() => assertKnownDials({ exaggeration: 0.7 }, turbo.dials, 'turbo')).toThrow(
            /variant "turbo" has no dial "exaggeration"; it has none/,
        );
    });

    it('names the available dials when there are some', () => {
        expect(() => assertKnownDials({ nope: 1 }, original.dials, 'original')).toThrow(/it has cfgWeight, exaggeration/);
    });

    it('refuses a value outside the declared range', () => {
        expect(() => assertKnownDials({ exaggeration: 9 }, original.dials, 'original')).toThrow(/takes 0 to 2/);
    });

    it('accepts a value inside it', () => {
        expect(assertKnownDials({ exaggeration: 0.7 }, original.dials, 'original')).toEqual({ exaggeration: 0.7 });
    });

    it('treats an absent params as an empty one', () => {
        expect(assertKnownDials(undefined, original.dials, 'original')).toEqual({});
    });
});

describe('performable', () => {
    it('strips a cue the variant does not claim and says which', () => {
        const result = performable({ text: 'a [laugh] b [groan] c' }, turbo, 'turbo');
        expect(result.text).toBe('a [laugh] b c');
        expect(result.dropped.cues).toEqual(['[groan]']);
    });

    it('drops a delivery the variant does not claim, silently but reportably', () => {
        const result = performable({ text: 'a line', delivery: 'hushed' }, turbo, 'turbo');
        expect(result.delivery).toBeUndefined();
        expect(result.dropped.delivery).toBe('hushed');
    });

    it('keeps a delivery the variant does claim', () => {
        const result = performable({ text: 'a line', delivery: 'hushed' }, original, 'original');
        expect(result.delivery).toBe('hushed');
        expect(result.dropped.delivery).toBeUndefined();
    });

    it('refuses an unknown dial rather than dropping it', () => {
        // Asymmetric on purpose. A cue this variant cannot perform is a capability gap and the core
        // makes the request performable; an unknown dial is a mistake and stays one.
        expect(() => performable({ text: 'x', params: { nope: 1 } }, original, 'original')).toThrow(DispatchError);
    });

    it('leaves a variant that performs everything alone', () => {
        const everything: Claims = { cues: [...turbo.cues, 'groan'], deliveries: ['hushed'], dials: {} };
        const result = performable({ text: 'a [laugh] b [groan] c', delivery: 'hushed' }, everything, 'x');
        expect(result.text).toBe('a [laugh] b [groan] c');
        expect(result.dropped).toEqual({ cues: [], delivery: undefined });
    });
});

describe('assertWithinCeiling', () => {
    it('uses the variant ceiling when it declares one', () => {
        expect(() => assertWithinCeiling('x'.repeat(11), { ...turbo, maxCharacters: 10 }, 4096)).toThrow(/accepts 10/);
    });

    it('falls back to the engine ceiling', () => {
        expect(() => assertWithinCeiling('x'.repeat(11), turbo, 10)).toThrow(/accepts 10/);
        expect(() => assertWithinCeiling('x'.repeat(10), turbo, 10)).not.toThrow();
    });
});

describe('performableDialogue', () => {
    const dia: Claims = {
        cues: ['laugh'],
        deliveries: [],
        dials: { temperature: { min: 0.5, max: 2, default: 1.8 } },
        maxCharacters: 40,
        dialogue: { maxSpeakers: 2 },
    };
    const turns = [
        { speaker: 'a', text: 'Hi [laugh] there' },
        { speaker: 'b', text: 'Oh [sigh] you' },
    ];

    it('strips from each turn the cues the variant does not claim, and keeps the rest', () => {
        const ready = performableDialogue({ turns }, dia, '1.6b', 4096);
        expect(ready.turns).toEqual([
            { speaker: 'a', text: 'Hi [laugh] there' },
            { speaker: 'b', text: 'Oh you' },
        ]);
        expect(ready.dropped.cues).toEqual(['[sigh]']);
    });

    it('refuses a variant that does not declare it', () => {
        expect(() => performableDialogue({ turns }, turbo, 'turbo', 4096)).toThrow(/does not speak dialogue/);
    });

    it('refuses more speakers than the variant takes, as unsupported', () => {
        const crowd = [...turns, { speaker: 'c', text: 'Me too' }];
        try {
            performableDialogue({ turns: crowd }, dia, '1.6b', 4096);
            expect.unreachable();
        } catch (error) {
            expect((error as DispatchError).code).toBe('unsupported');
            expect((error as DispatchError).message).toMatch(/3 speakers/);
        }
    });

    it('holds the whole conversation to one ceiling, however it is split', () => {
        // Each turn is under 40 characters; together they are not.
        const long = [
            { speaker: 'a', text: 'x'.repeat(25) },
            { speaker: 'b', text: 'y'.repeat(25) },
        ];
        expect(() => performableDialogue({ turns: long }, dia, '1.6b', 4096)).toThrow(/come to 50 characters/);
    });

    it('checks the dials once, as for speaking', () => {
        expect(() => performableDialogue({ turns, params: { speed: 1 } }, dia, '1.6b', 4096)).toThrow(/no dial "speed"/);
        expect(performableDialogue({ turns, params: { temperature: 1.2 } }, dia, '1.6b', 4096).params).toEqual({ temperature: 1.2 });
    });

    it('refuses an empty conversation', () => {
        expect(() => performableDialogue({ turns: [] }, dia, '1.6b', 4096)).toThrow(DispatchError);
    });
});
