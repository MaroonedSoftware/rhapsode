import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NOTICE } from '../scripts/docs.sync.mjs';

// The repository's house style (CLAUDE.md, "Conventions"): no em dashes in prose. A site is the one
// place a reader meets the prose first, so the rule is checked here rather than trusted.

const site = resolve(import.meta.dirname, '..');

/** Every file under `dir` with one of `extensions`, depth first. */
async function walk(dir: string, extensions: string[]): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const nested = await Promise.all(
        entries.map(entry => {
            const path = join(dir, entry.name);
            if (entry.isDirectory()) return walk(path, extensions);
            return extensions.some(extension => entry.name.endsWith(extension)) ? [path] : [];
        }),
    );
    return nested.flat();
}

describe('the site prose', () => {
    it('has no em dashes in anything written here', async () => {
        const files = [...(await walk(join(site, 'docs'), ['.md', '.mdx'])), ...(await walk(join(site, 'src'), ['.ts', '.tsx', '.md']))];
        const offenders: string[] = [];
        for (const file of files) {
            const text = await readFile(file, 'utf8');
            // A page copied in from elsewhere is held to the rule where it is written, not here, and a
            // generated one is ContractKit's to write. `index.md` in the API section is the one page
            // there written by hand.
            if (text.includes(NOTICE)) continue;
            const path = relative(site, file);
            if (path.startsWith(join('docs', 'api-reference')) && path !== join('docs', 'api-reference', 'index.md')) continue;
            if (text.includes('\u2014')) offenders.push(path);
        }
        expect(offenders).toEqual([]);
    });
});
