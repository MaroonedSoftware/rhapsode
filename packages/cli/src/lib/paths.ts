import { isAbsolute, join, relative, resolve } from 'node:path';

/** Where things are, relative to the repository root johnny5 resolves. */
export const VENV = 'python/.venv';
export const SERVER_ENTRY = 'apps/server/dist/main.js';
export const CONFIG_FILE = 'rhapsode.config.json';

/**
 * The Python modules `pnpm python:sync` installs into the shared dev venv. Chatterbox and Kokoro are
 * here without their engines: each adapter imports its engine lazily, so the module loads and its
 * tests stub the model.
 */
export const DEV_MODULES = ['rhapsode_worker', 'rhapsode_engine_tone', 'rhapsode_conform', 'rhapsode_engine_chatterbox', 'rhapsode_engine_kokoro'];

/** The interpreter inside a virtualenv, laid out the way `venv` and `uv` both lay it out. */
export const venvPython = (venv: string): string =>
    process.platform === 'win32' ? join(venv, 'Scripts', 'python.exe') : join(venv, 'bin', 'python');

/**
 * The config file the server would read. `pnpm wizard` runs from `packages/cli`, so a relative
 * `RHAPSODE_CONFIG` is taken against the repository root, which is where the README starts the
 * server from.
 */
export const configPath = (repoRoot: string, env: NodeJS.ProcessEnv): string => resolve(repoRoot, env.RHAPSODE_CONFIG ?? CONFIG_FILE);

/** A path relative to the repository when it is inside it, and absolute when it is not. */
export const displayPath = (repoRoot: string, path: string): string => {
    const inside = relative(repoRoot, path);
    return inside.startsWith('..') || isAbsolute(inside) ? path : inside;
};
