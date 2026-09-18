import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { newestMtime } from '../../src/lib/mtime.js';

describe('newestMtime', () => {
    it('is zero for a directory that does not exist', () => {
        expect(newestMtime(join(tmpdir(), 'rhapsode-cli-nowhere'), '.ts')).toBe(0);
    });

    it('finds the newest matching file at any depth and ignores other extensions', () => {
        const root = mkdtempSync(join(tmpdir(), 'rhapsode-cli-'));
        mkdirSync(join(root, 'deep'));
        const files = { 'a.ts': 1_000, 'deep/b.ts': 3_000, 'deep/c.js': 9_000 };
        for (const [name, seconds] of Object.entries(files)) {
            writeFileSync(join(root, name), '');
            utimesSync(join(root, name), seconds, seconds);
        }
        expect(newestMtime(root, '.ts')).toBe(3_000_000);
    });
});
