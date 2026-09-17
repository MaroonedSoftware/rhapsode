import { describe, expect, it } from 'vitest';

import { CONTRACT_MAJOR } from '../src/index.js';

describe('the contract', () => {
    it('is major 1', () => {
        expect(CONTRACT_MAJOR).toBe(1);
    });
});
