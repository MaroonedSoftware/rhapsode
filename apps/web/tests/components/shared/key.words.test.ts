import { describe, expect, it } from 'vitest';

import { keyWords } from '../../../src/components/shared/key.words';

describe('keyWords', () => {
    it('writes a camelCase key as words, keeping an initialism in capitals', () => {
        expect(keyWords('cfgWeight')).toBe('CFG weight');
    });

    it('splits snake and kebab case', () => {
        expect(keyWords('top_p')).toBe('Top P');
        expect(keyWords('speaking-rate')).toBe('Speaking rate');
    });

    it('capitalises a single word and leaves an empty key alone', () => {
        expect(keyWords('exaggeration')).toBe('Exaggeration');
        expect(keyWords('')).toBe('');
    });
});
