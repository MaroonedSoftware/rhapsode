#!/usr/bin/env node
// Generated output is committed, so the only thing keeping it honest is a check that regenerating
// changes nothing. It is committed because the Python half has no Node toolchain at install time
// and cannot generate on demand.

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GENERATED = [
    'packages/contract/src/generated',
    'python/rhapsode-worker/src/rhapsode_worker/_contract',
    'python/conformance/src/rhapsode_conform/_generated',
    'docs/openapi.yaml',
];

const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' }).stdout.trim();

// Unstaged edits only. Staged-but-uncommitted generated output is the normal state mid-commit, and
// refusing it would make the check unrunnable exactly when you want to run it.
const dirty = () =>
    [git('diff', '--name-only', '--', ...GENERATED), git('ls-files', '--others', '--exclude-standard', '--', ...GENERATED)]
        .filter(Boolean)
        .join('\n');

const before = dirty();
if (before) {
    console.error(`codegen:check needs the generated paths to match the index, and found:\n${before}`);
    process.exit(2);
}

const generated = spawnSync('pnpm', ['run', 'codegen'], { cwd: root, stdio: 'inherit' });
if (generated.status !== 0) process.exit(generated.status ?? 1);

const after = dirty();
if (after) {
    console.error(`The committed contract output is stale. Run \`pnpm codegen\` and commit:\n${after}`);
    console.error(git('diff', '--stat', '--', ...GENERATED));
    process.exit(1);
}
console.log('codegen:check: the committed output matches the contract');
