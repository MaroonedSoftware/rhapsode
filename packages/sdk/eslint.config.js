//  @ts-check

import base from '@repo/config-eslint/base.js';

/** @type {import("eslint").Linter.Config[]} */
export default [
    ...base,
    // Written by `pnpm codegen`. A lint fix there is a diff the next generation takes back, and
    // `codegen:check` then fails on a tree nobody edited.
    { ignores: ['src/generated/**'] },
];
