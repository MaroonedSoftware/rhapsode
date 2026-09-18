import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Check } from '@maroonedsoftware/johnny5';

import { DEV_MODULES, VENV, venvPython } from '../lib/paths.js';
import { pythonSync } from '../lib/python.sync.js';

/**
 * `python/.venv` exists and every package in it imports. Importing rather than checking for the
 * directory, because the venv that half-installed (pip died on a certificate after creating it) is
 * the common broken one, and it has a perfectly good `bin/python`.
 */
export const pythonVenv: Check = {
    name: 'python venv synced',
    run: async ctx => {
        const python = venvPython(resolve(ctx.paths.repoRoot, VENV));
        if (!existsSync(python)) return { ok: false, message: `${VENV} not found`, fixHint: 'Run `pnpm python:sync`.' };
        try {
            await ctx.shell.run(python, ['-c', `import ${DEV_MODULES.join(', ')}`]);
        } catch {
            return { ok: false, message: 'the venv exists but its packages do not all import', fixHint: 'Run `pnpm python:sync`.' };
        }
        return { ok: true, message: `${DEV_MODULES.length} packages import` };
    },
    autoFix: async ctx => {
        const exit = await pythonSync(ctx);
        return exit === 0
            ? { ok: true, message: 'synced' }
            : {
                  ok: false,
                  message: `python:sync exited ${exit}`,
                  fixHint: 'If pip could not verify a certificate, run `pnpm wizard setup`, which offers to retry trusting PyPI.',
              };
    },
};
