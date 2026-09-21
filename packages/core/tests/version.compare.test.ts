import { describe, expect, it } from 'vitest';

import { isNewer, parseVersion } from '../src/update/version.compare.js';

describe('parseVersion', () => {
    it('reads a tag with or without its v', () => {
        expect(parseVersion('v0.2.0')).toEqual({ major: 0, minor: 2, patch: 0 });
        expect(parseVersion('0.2.0')).toEqual({ major: 0, minor: 2, patch: 0 });
    });

    it('keeps a prerelease and drops build metadata', () => {
        expect(parseVersion('1.0.0-rc.1+g1234abc')).toEqual({ major: 1, minor: 0, patch: 0, prerelease: 'rc.1' });
    });

    it('refuses what is not a release version', () => {
        expect(parseVersion('latest')).toBeUndefined();
        expect(parseVersion('0.2')).toBeUndefined();
        expect(parseVersion('')).toBeUndefined();
    });
});

describe('isNewer', () => {
    it('offers a later release, by number rather than by string', () => {
        expect(isNewer('0.1.10', '0.1.9')).toBe(true);
        expect(isNewer('v0.2.0', '0.1.9')).toBe(true);
        expect(isNewer('1.0.0', '0.99.99')).toBe(true);
    });

    it('offers nothing when the core is on it', () => {
        expect(isNewer('0.1.9', '0.1.9')).toBe(false);
    });

    it('never offers a downgrade to a core ahead of the latest release, as a checkout often is', () => {
        expect(isNewer('0.1.9', '0.2.0')).toBe(false);
    });

    it('offers the release to a core at a prerelease of it', () => {
        expect(isNewer('0.2.0', '0.2.0-rc.1')).toBe(true);
    });

    it('never offers a prerelease, even one that reached latest', () => {
        expect(isNewer('0.3.0-rc.1', '0.2.0')).toBe(false);
    });

    it('offers nothing for a tag it cannot read', () => {
        expect(isNewer('nightly', '0.1.9')).toBe(false);
    });
});
