import { spawn } from 'node:child_process';
import { basename } from 'node:path';
import { createInterface } from 'node:readline';

import type { PlannedCommand } from './install.plan.js';

export type OutputLine = (line: string, stream: 'stdout' | 'stderr') => void;

/** Runs one planned command to completion, reporting each line it prints. Rejects on a non-zero exit. */
export type CommandRunner = (command: PlannedCommand, onLine: OutputLine, signal: AbortSignal) => Promise<void>;

/**
 * What an install's child processes see of the server's environment.
 *
 * Constructed rather than inherited, as a worker's is, so that pip never sees the core's
 * `VIRTUAL_ENV` or `PYTHONPATH` and installs into the wrong place. The proxy and certificate
 * variables are passed through because they are how a network that intercepts TLS is made to work,
 * and pip reads them.
 */
const PASSED_THROUGH = [
    'PATH',
    'HOME',
    'LANG',
    'TMPDIR',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'NO_PROXY',
    'http_proxy',
    'https_proxy',
    'no_proxy',
    'SSL_CERT_FILE',
    'REQUESTS_CA_BUNDLE',
    'PIP_CERT',
    'PIP_INDEX_URL',
    'PIP_EXTRA_INDEX_URL',
];

export function installEnvironment(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
    const constructed: Record<string, string> = { LANG: 'C.UTF-8', PIP_DISABLE_PIP_VERSION_CHECK: '1', PYTHONUNBUFFERED: '1' };
    for (const name of PASSED_THROUGH) {
        const value = env[name];
        if (value !== undefined) constructed[name] = value;
    }
    return constructed;
}

/**
 * The real runner: spawn, forward lines, and fail with the last thing the command said.
 *
 * pip's last line on a failure is nearly always the one that explains it ("No matching distribution
 * found for ..."), and a job error that said only "exited 1" would send the operator to the log for
 * the one line that belonged in the error.
 */
export const spawnRunner: CommandRunner = (command, onLine, signal) =>
    new Promise((fulfil, reject) => {
        const child = spawn(command.command, command.args, { env: installEnvironment(), stdio: ['ignore', 'pipe', 'pipe'], signal });
        let last = '';
        const follow = (stream: NodeJS.ReadableStream, name: 'stdout' | 'stderr') => {
            createInterface({ input: stream }).on('line', line => {
                if (line.trim() !== '') last = line.trim();
                onLine(line, name);
            });
        };
        follow(child.stdout, 'stdout');
        follow(child.stderr, 'stderr');

        child.on('error', reject);
        child.on('close', (code, killedBy) => {
            if (code === 0) return fulfil();
            const how = code === null ? `was killed by ${killedBy ?? 'a signal'}` : `exited ${code}`;
            reject(new Error(`${basename(command.command)} ${how}${last === '' ? '' : `: ${last}`}`));
        });
    });
