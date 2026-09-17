import { describe, expect, it } from 'vitest';

describe('the server entrypoint', () => {
    it('is buildable', async () => {
        await expect(import('@rhapsode/contract')).resolves.toBeDefined();
    });
});
