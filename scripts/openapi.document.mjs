#!/usr/bin/env node
// Finish the two OpenAPI documents ContractKit writes, and hand the public one to the core to serve.
// protocol.md § 9.
//
// Two things the generator cannot do:
//
// - Carry the release version. `info.version` comes from the core's own package.json, the number
//   `pnpm release version` sets, so the committed documents and the served one agree. A version in
//   the contractkit config would be a second copy of the number, and the first one left behind.
// - Be imported. The core is bundled by tsup and ships without `docs/`, so the public document is
//   also written as a module in `@rhapsode/contract`, which the core already depends on.
//
// Like scripts/contract.models.mjs, this rewrites generator output, and is only safe because it runs
// inside `pnpm codegen`, which `codegen:check` reruns from a clean tree. `pnpm release version` runs
// it alone, since a version bump changes nothing else it touches, and it is idempotent for that.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse, stringify } from 'yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(readFileSync(join(root, 'packages/core/package.json'), 'utf8')).version;

/** The document at `path`, stamped with the release version and written back. */
function finish(path) {
    const document = parse(readFileSync(join(root, path), 'utf8'));
    const finished = { ...document, info: { ...document.info, version } };
    writeFileSync(join(root, path), stringify(finished, { indent: 4, lineWidth: 0 }));
    return finished;
}

const publicDocument = finish('docs/openapi.yaml');
finish('docs/openapi.worker.yaml');

writeFileSync(
    join(root, 'packages/contract/src/generated/openapi.document.ts'),
    [
        '// Generated from docs/openapi.yaml by scripts/openapi.document.mjs. Do not edit manually.',
        '// The public API as the core serves it at GET /openapi.json. protocol.md § 9.',
        '',
        "import type { OpenApiDocument } from './rhapsode.public.schema.js';",
        '',
        `export const OPENAPI_DOCUMENT: OpenApiDocument = ${JSON.stringify(publicDocument, undefined, 4)};`,
        '',
    ].join('\n'),
);

console.log(`openapi.document: ${Object.keys(publicDocument.paths).length} public paths at ${version}`);
