#!/usr/bin/env node
// Generated output is committed, so the only thing that keeps it honest is a check that
// regenerating changes nothing. Run in CI, and worth running before a commit that touches
// contracts/.

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GENERATED = ['packages/contract/src/generated', 'python/rhapsode-worker/src/rhapsode_worker/_contract', 'docs/openapi.yaml'];

const git = args => spawnSync('git', args, { cwd: root, encoding: 'utf8' });

const before = git(['status', '--porcelain', '--', ...GENERATED]).stdout;
if (before.trim()) {
    console.error('codegen:check needs a clean tree for the generated paths, and found:\n' + before);
    process.exit(2);
}

const generate = spawnSync('pnpm', ['run', 'codegen'], { cwd: root, stdio: 'inherit' });
if (generate.status !== 0) process.exit(generate.status ?? 1);

const after = git(['status', '--porcelain', '--', ...GENERATED]).stdout;
if (after.trim()) {
    console.error('The committed contract output is stale. Run `pnpm codegen` and commit:\n' + after);
    console.error(git(['diff', '--stat', '--', ...GENERATED]).stdout);
    process.exit(1);
}
console.log('codegen:check: generated output matches the contract');
