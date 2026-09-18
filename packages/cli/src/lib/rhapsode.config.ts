import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import type { RhapsodeConfig } from '@rhapsode/core';

export type ConfigRead = { status: 'missing' } | { status: 'invalid'; error: string } | { status: 'ok'; config: RhapsodeConfig };

/**
 * The config file as the server would see it. A missing file is not an error to the server, which
 * starts with no engines at all, and that is exactly why the doctor reports it: a server with nothing
 * to route to answers `/engines` with an empty list and looks healthy.
 */
export const readConfig = (path: string): ConfigRead => {
    if (!existsSync(path)) return { status: 'missing' };
    try {
        const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return { status: 'invalid', error: 'the top level is not an object' };
        }
        return { status: 'ok', config: parsed as RhapsodeConfig };
    } catch (error) {
        return { status: 'invalid', error: (error as Error).message };
    }
};

/** An engine the server would spawn itself, with its venv resolved the way the doctor checks it. */
export interface LocalEngine {
    id: string;
    venv: string;
}

/**
 * Engines with a `venv`, skipping disabled ones and remote ones (a `url` means another machine owns
 * the process). A relative venv is resolved against the repository root, which is where the README
 * starts the server from; the server itself resolves it against its own working directory.
 */
export const localEngines = (config: RhapsodeConfig, repoRoot: string): LocalEngine[] =>
    Object.entries(config.engines ?? {})
        .filter(([, entry]) => entry.enabled !== false && entry.url === undefined && entry.venv !== undefined)
        .map(([id, entry]) => ({ id, venv: isAbsolute(entry.venv!) ? entry.venv! : resolve(repoRoot, entry.venv!) }));

/**
 * The first config for a checkout: the tone engine on the shared dev venv. The venv path is
 * absolute so the server can be started from anywhere, which is safe because the file is gitignored
 * and so never leaves this machine.
 */
export const starterConfig = (port: number, venv: string): RhapsodeConfig => ({
    server: { port },
    engines: { tone: { venv } },
});

export const renderConfig = (config: RhapsodeConfig): string => `${JSON.stringify(config, undefined, 4)}\n`;
