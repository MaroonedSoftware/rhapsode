import { describe, expect, it } from 'vitest';

import { skipReason } from '../../src/lib/reinstall.js';

describe('what a reinstall of everything skipped', () => {
    it('says how to accept a licence again, for the one skip a person has to act on', () => {
        expect(skipReason({ engine: 'research', reason: 'licence' })).toContain('pnpm wizard reinstall research');
    });

    it('names the engine and the reason for the others', () => {
        expect(skipReason({ engine: 'tone', reason: 'busy' })).toMatch(/^tone .*already has a job/);
        expect(skipReason({ engine: 'gone', reason: 'uncatalogued' })).toMatch(/^gone .*catalog no longer has it/);
    });
});
