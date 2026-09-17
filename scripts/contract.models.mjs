#!/usr/bin/env node
// Reduce the SDK's generated contract package to models, and nothing else.
//
// `@contractkit/plugin-python` is a client generator, so even a config that matches no operations
// still emits `_base_client.py` and an `__init__.py` that imports it, and `_base_client.py` imports
// httpx. That would make httpx a hard dependency of `rhapsode-worker`, and the SDK must install for
// an adapter author who has onnxruntime and no HTTP client library, so the import has to go.
//
// Deleting files a generator wrote is only safe because this runs inside `pnpm codegen`, which
// `codegen:check` reruns from a clean tree: the committed result is what this script produces, not
// what the generator produces, and drift in either one fails the same check.

import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const contractDir = join(root, 'python/rhapsode-worker/src/rhapsode_worker/_contract');
const modelsModule = '_models_rhapsode_types';

for (const file of ['_base_client.py', 'requirements.txt']) {
    rmSync(join(contractDir, file), { force: true });
}

const models = readFileSync(join(contractDir, `${modelsModule}.py`), 'utf8');
const names = [...models.matchAll(/^class (\w+)\(/gm)].map(match => match[1]).sort();
if (names.length === 0) throw new Error(`no models found in ${modelsModule}.py`);

const header = [
    '# Generated from contracts/rhapsode.types.ck, then reduced to models by',
    '# scripts/contract.models.mjs. Do not edit manually.',
    '#',
    "# The client half of the generator's output is deliberately absent: it imports httpx, and the",
    '# worker SDK has to install for an adapter that has no HTTP client library of its own.',
    '',
    `from .${modelsModule} import (`,
    ...names.map(name => `    ${name},`),
    ')',
    '',
    '__all__ = [',
    ...names.map(name => `    "${name}",`),
    ']',
    '',
].join('\n');

writeFileSync(join(contractDir, '__init__.py'), header);
console.log(`contract.models: ${names.length} models re-exported, client half removed`);
