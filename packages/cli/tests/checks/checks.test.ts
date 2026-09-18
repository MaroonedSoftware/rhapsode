import { describe, expect, it } from 'vitest';

import { atLeast } from '../../src/checks/pnpm.version.js';
import { parsePythonVersion } from '../../src/checks/python.version.js';

describe('atLeast', () => {
    it.each([
        ['11.23.0', '11.23.0', true],
        ['11.23.1', '11.23.0', true],
        ['12.0.0', '11.23.0', true],
        ['11.9.9', '11.23.0', false],
        ['3.10.14', '3.11.0', false],
        ['3.14.7', '3.11.0', true],
    ])('%s against a floor of %s is %s', (installed, floor, expected) => {
        expect(atLeast(installed, floor)).toBe(expected);
    });
});

describe('parsePythonVersion', () => {
    it('reads the version out of `python --version`', () => {
        expect(parsePythonVersion('Python 3.14.7\n')).toBe('3.14.7');
    });

    it('is undefined for anything else', () => {
        expect(parsePythonVersion('command not found')).toBeUndefined();
    });
});
