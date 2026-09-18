import type { Check } from '@maroonedsoftware/johnny5';

import { atLeast } from './pnpm.version.js';

/** Every package under python/ declares `requires-python = ">=3.11"`. */
export const PYTHON_FLOOR = '3.11.0';

/** The version out of `python --version`, which prints `Python 3.14.7`. */
export const parsePythonVersion = (output: string): string | undefined => output.match(/Python (\d+\.\d+\.\d+)/)?.[1];

/**
 * The interpreter `pnpm python:sync` would build the venv from. It honours `PYTHON` the same way
 * `scripts/python.mjs` does, so the doctor checks the one that will actually be used.
 */
export const pythonVersion: Check = {
    name: `python ≥ ${PYTHON_FLOOR.replace(/\.0$/, '')}`,
    run: async ctx => {
        const python = ctx.env.PYTHON ?? 'python3';
        let output: string;
        try {
            const result = await ctx.shell.run(python, ['--version']);
            output = `${String(result.stdout)}${String(result.stderr)}`;
        } catch {
            return { ok: false, message: `${python} is not on PATH`, fixHint: 'Install Python 3.11 or newer, or point PYTHON at one.' };
        }
        const version = parsePythonVersion(output);
        if (!version) return { ok: false, message: `could not read a version from \`${python} --version\`` };
        if (!atLeast(version, PYTHON_FLOOR)) {
            return { ok: false, message: `${python} is ${version}`, fixHint: 'Install Python 3.11 or newer, or point PYTHON at one.' };
        }
        return { ok: true, message: `${python} ${version}` };
    },
};
