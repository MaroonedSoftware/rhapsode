import { describe, expect, it } from 'vitest';

describe('the server package', () => {
    it('depends only on the core, which is the whole of its job', async () => {
        const manifest = await import('../package.json', { with: { type: 'json' } });
        expect(Object.keys(manifest.default.dependencies).sort()).toEqual(['@rhapsode/contract', '@rhapsode/core']);
    });
});
