import { existsSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { RhapsodeConfig } from '../config.js';

export interface InstallSettings {
    venvDir: string;
    sourceDir?: string;
    python: string;
    trustedHosts: string[];
}

export function resolveInstallSettings(settings: RhapsodeConfig, env: NodeJS.ProcessEnv = process.env): InstallSettings {
    return {
        venvDir: resolve(settings.install?.venvDir ?? join(homedir(), '.rhapsode', 'venvs')),
        sourceDir: settings.install?.sourceDir === undefined ? checkoutPythonDir() : resolve(settings.install.sourceDir),
        python: settings.install?.python ?? 'python3',
        // Read from the server's own environment and nowhere else. Weakening certificate checks is a
        // decision made on the box, and a request that could ask for it would make it everybody's.
        trustedHosts: (env.RHAPSODE_PIP_TRUSTED_HOSTS ?? '')
            .split(',')
            .map(host => host.trim())
            .filter(host => host !== ''),
    };
}

/**
 * The `python/` directory of the checkout this module is running from, if it is running from one.
 *
 * Found by walking up rather than by a fixed number of `..`, because the same code runs bundled from
 * `dist/` and unbundled from `src/` under a test runner, at different depths.
 */
export function checkoutPythonDir(from: string = dirname(fileURLToPath(import.meta.url))): string | undefined {
    let directory = from;
    for (let depth = 0; depth < 8; depth += 1) {
        const candidate = join(directory, 'python');
        if (existsSync(join(candidate, 'rhapsode-worker', 'pyproject.toml'))) return candidate;
        const parent = dirname(directory);
        if (parent === directory) return undefined;
        directory = parent;
    }
    return undefined;
}

/** A package's directory under `sourceDir` when it has one there, otherwise its name for the index. */
export function sourceFor(pkg: string, sourceDir: string | undefined): string {
    if (sourceDir !== undefined && existsSync(join(sourceDir, pkg, 'pyproject.toml'))) return join(sourceDir, pkg);
    return pkg;
}

/** Whether an executable is on the server's PATH, without running it. */
export async function onPath(name: string, path: string = process.env.PATH ?? ''): Promise<boolean> {
    for (const directory of path.split(delimiter)) {
        if (directory === '') continue;
        try {
            await access(join(directory, name), constants.X_OK);
            return true;
        } catch {
            // Not here.
        }
    }
    return false;
}
