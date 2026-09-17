import { describe, expect, it } from 'vitest';

import { Capabilities, CONTRACT_MAJOR, CUES, DELIVERIES, SpeakRequest, Variant } from '../src/index.js';

describe('the contract', () => {
    it('is major 1', () => {
        expect(CONTRACT_MAJOR).toBe(1);
    });

    it('carries the eight cues and the two deliveries', () => {
        expect(CUES).toEqual(['laugh', 'chuckle', 'sigh', 'gasp', 'cough', 'clear throat', 'sniff', 'groan']);
        expect(DELIVERIES).toEqual(['hushed', 'frantic']);
    });
});

describe('the generated schemas', () => {
    it('parse a capability document whose model is unloaded', () => {
        // § 4 as amended: `current` is absent when nothing is resident, and nothing may depend on it.
        const parsed = Capabilities.parse({
            contract: 1,
            engine: { id: 'tone', displayName: 'Tone', adapterVersion: '0.0.0' },
            license: { code: 'MIT', weights: 'MIT', weightsCommercialUse: true },
            device: { type: 'cpu', name: 'test' },
            variants: { default: { cues: [], deliveries: [], dials: {} } },
            formats: ['wav', 'pcm'],
        });

        expect(parsed.current).toBeUndefined();
        expect(parsed.contract).toBe(1);
    });

    it('lets an older reader through a newer worker’s extra fields', () => {
        // § 9: additive only, and a reader ignores what it does not know. A strict schema would
        // turn every additive change into a hard failure at the version skew § 9 exists to survive.
        const parsed = Variant.parse({ cues: [], deliveries: [], dials: {}, addedInContract2: true });

        expect(parsed).toMatchObject({ addedInContract2: true });
    });

    it('refuses a speak request with a misspelled field', () => {
        // The other direction, and deliberately not symmetrical. `streaming` is not `stream`, and a
        // silently dropped intention is the failure § 6 spends a section arguing against.
        expect(() => SpeakRequest.parse({ text: 'hello', streaming: true })).toThrow();
    });

    it('refuses an empty text', () => {
        expect(() => SpeakRequest.parse({ text: '' })).toThrow();
    });
});
