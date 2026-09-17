import { describe, expect, it } from 'vitest';

import { CONTRACT_MAJOR } from '../src/index.js';

describe('the core', () => {
    it('re-exports the contract major', () => {
        expect(CONTRACT_MAJOR).toBe(1);
    });
});
