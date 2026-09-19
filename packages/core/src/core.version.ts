import { readFileSync } from 'node:fs';

/**
 * This core's package version, read from its own `package.json`.
 *
 * Read at run time rather than written in by the build, because the release bumps `package.json`
 * and nothing else, and a second copy of the number is one that can be left behind. The path is the
 * same from `src/` under test and from `dist/` once built: both sit one level below the package root.
 *
 * Not the contract. § 9: this says which code this is, and `contract` says what it can say.
 */
export const CORE_VERSION: string = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
