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
 * How many of a command's last lines are kept to explain a failure. A build that fails in the
 * compiler prints its error some way above pip's summary, and a C++ error can run to hundreds of
 * lines; the lines themselves cost nothing to keep until the command exits.
 */
const EXPLAINING_LINES = 500;

/**
 * Lines that are pip talking about a failure rather than saying what it was: its box-drawn frame
 * (`×`, `│`, `╰─>`), its `note:` and `hint:` advice, the `[end of output]` that closes a quoted
 * subprocess, its kebab-case diagnostic codes (`error: subprocess-exited-with-error`), and the
 * summaries that only name the package whose build failed.
 */
const PIP_NOISE = [
    /^[×│╰╭├─]/u,
    /^(note|hint):/i,
    /^\[end of output\]$/i,
    /^error: [a-z]+(-[a-z]+)+$/,
    /^(ERROR: )?Failed (building wheel for|to build) /i,
    /^Successfully built /i,
    /: finished with status 'error'$/,
];

/** Which package pip was building when it failed, from its own summary of the failure. */
const FAILED_BUILD = /^(?:ERROR: )?Failed (?:building wheel for|to build) ([\w.-]+)$/i;

/**
 * The line that says why a command failed, from the lines it printed.
 *
 * The last line used to be the answer, and for "No matching distribution found for ..." it is. For a
 * package built from source it is pip's footer: the Orpheus install in the server image failed with
 * `╰─> llama-cpp-python`, while the reason (`CMake Error: CMAKE_C_COMPILER not set`) sat thirty lines
 * up, in a feed an operator reading the job does not see. So pip's framing is skipped, and the last
 * line that says `error` is preferred to the last line.
 *
 * A certificate failure is preferred to both. pip reports it as a warning and then says every
 * package has "No matching distribution", which sends the operator to check package names when the
 * network is what needs fixing.
 */
export function failureReason(lines: readonly string[]): string | undefined {
    const said = lines.map(line => line.trim()).filter(line => line !== '');
    const meaningful = said.filter(line => !PIP_NOISE.some(noise => noise.test(line)));

    const reason =
        lastOf(meaningful, line => /certificate/i.test(line)) ??
        lastOf(meaningful, line => /\berror\b/i.test(line)) ??
        meaningful.at(-1) ??
        said.at(-1);
    if (reason === undefined) return undefined;

    const building = lastOf(said, line => FAILED_BUILD.test(line))?.match(FAILED_BUILD)?.[1];
    return building === undefined || reason.includes(building) ? reason : `${reason} (building ${building})`;
}

/** `Array.prototype.findLast`, which is ES2023 and this package compiles against ES2022. */
function lastOf(lines: readonly string[], matches: (line: string) => boolean): string | undefined {
    for (let index = lines.length - 1; index >= 0; index -= 1) {
        if (matches(lines[index]!)) return lines[index];
    }
    return undefined;
}

/**
 * The real runner: spawn, forward lines, and fail with the line that says why.
 *
 * A job error that said only "exited 1" would send the operator to the log for the one line that
 * belonged in the error. {@link failureReason} says which line that is.
 */
export const spawnRunner: CommandRunner = (command, onLine, signal) =>
    new Promise((fulfil, reject) => {
        const child = spawn(command.command, command.args, { env: installEnvironment(), stdio: ['ignore', 'pipe', 'pipe'], signal });
        const printed: string[] = [];
        const follow = (stream: NodeJS.ReadableStream, name: 'stdout' | 'stderr') => {
            createInterface({ input: stream }).on('line', line => {
                printed.push(line);
                if (printed.length > EXPLAINING_LINES) printed.shift();
                onLine(line, name);
            });
        };
        follow(child.stdout, 'stdout');
        follow(child.stderr, 'stderr');

        child.on('error', reject);
        child.on('close', (code, killedBy) => {
            if (code === 0) return fulfil();
            const how = code === null ? `was killed by ${killedBy ?? 'a signal'}` : `exited ${code}`;
            const why = failureReason(printed);
            reject(new Error(`${basename(command.command)} ${how}${why === undefined ? '' : `: ${why}`}`));
        });
    });
