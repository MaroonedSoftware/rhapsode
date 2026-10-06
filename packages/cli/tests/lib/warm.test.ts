import { describe, expect, it } from 'vitest';

import { unwarmed } from '../../src/lib/warm.js';

const variant = (compiles?: boolean) => ({ cues: [], deliveries: [], dials: {}, ...(compiles === undefined ? {} : { compiles }) });

describe('what is left to warm', () => {
    // Orpheus on Linux: full compiles, the GGUF builds do not. protocol.md § 8.
    const orpheus = { variants: { full: variant(true), q8: variant(), q4: variant(false) } };

    it('is every variant that compiles, for an engine nothing has warmed', () => {
        expect(unwarmed({}, orpheus)).toEqual(['full']);
    });

    it('leaves out what the catalog says was warmed', () => {
        expect(unwarmed({ warmed: ['full'] }, orpheus)).toEqual([]);
    });

    it('is nothing for an engine with no variant that compiles', () => {
        expect(unwarmed({}, { variants: { plain: variant() } })).toEqual([]);
    });

    it('ignores a recorded variant the worker no longer declares', () => {
        expect(unwarmed({ warmed: ['gone'] }, orpheus)).toEqual(['full']);
    });
});
