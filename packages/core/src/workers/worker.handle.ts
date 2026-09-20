import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, unlink } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';

import { Logger } from '@maroonedsoftware/logger';
import { CONTRACT_MAJOR, WORKER_ENV } from '@rhapsode/contract';
import { DateTime } from 'luxon';

import { RhapsodeError } from '../errors/rhapsode.error.js';
import type { EngineEntry } from '../registry/engine.registry.js';
import { WorkerClient } from './worker.client.js';

/** Kept for exactly one purpose: to be the error message when a worker dies before its handshake. */
const STDERR_RING_LINES = 40;

/** `sun_path` is 104 bytes on macOS and 108 on Linux, and the failure is an opaque EINVAL at bind. */
const MAX_SOCKET_PATH = 100;

export interface SupervisorOptions {
    socketDir?: string;
    /**
     * Each local worker's voice store is `<voiceDir>/<engine>`, unless the engine's `env` names one.
     * Without it a worker stores voices under its working directory, which is the core's, and under
     * `pnpm dev` that is inside the repository.
     */
    voiceDir?: string;
    startupTimeoutSeconds: number;
    drainGraceMs: number;
    maxRestarts: number;
    restartDecaySeconds: number;
}

export interface WorkerHandle {
    readonly id: string;
    readonly client: WorkerClient | undefined;
    ensureUp(): Promise<WorkerClient>;
    stop(reason: 'shutdown' | 'evict' | 'uninstall'): Promise<void>;
    readonly restarts: number;
    readonly lastError: string | undefined;
}

/**
 * A worker on another machine.
 *
 * Every difference from a local one is in this class: there is no handshake, no signal to send and
 * no process to restart. Everything above `WorkerHandle` is unchanged, which is the payoff § 1
 * promises for "a remote worker is a URL".
 */
export class RemoteWorkerHandle implements WorkerHandle {
    readonly client: WorkerClient;
    restarts = 0;
    lastError: string | undefined;

    constructor(
        readonly id: string,
        url: string,
        client?: WorkerClient,
    ) {
        this.client = client ?? new WorkerClient({ url });
    }

    async ensureUp(): Promise<WorkerClient> {
        return this.client;
    }

    async stop(reason: 'shutdown' | 'evict' | 'uninstall'): Promise<void> {
        // Not ours to exit. `terminate` over HTTP is the only reclaim available here, which is why
        // the protocol has that verb at all.
        if (reason === 'evict') {
            // And the pool stays open across it. Closing it is what an eviction used to do, which
            // left `ensureUp` handing out a client whose pool was destroyed: the engine answered
            // nothing until the core restarted. Idle freeing makes that path routine rather than
            // rare, so the reclaim and the connection are now separate things.
            await this.client.terminate();
            return;
        }
        await this.client.close();
    }
}

/** A worker this core spawned, and is therefore responsible for. */
export class LocalWorkerHandle implements WorkerHandle {
    client: WorkerClient | undefined;
    restarts = 0;
    lastError: string | undefined;

    private child: ChildProcess | undefined;
    private socketPath: string | undefined;
    private starting: Promise<WorkerClient> | undefined;
    private wanted = false;
    private upSince: DateTime | undefined;
    private readonly stderrRing: string[] = [];

    constructor(
        readonly id: string,
        private readonly entry: EngineEntry,
        private readonly options: SupervisorOptions,
        private readonly logger: Logger,
        private readonly onState: (state: { process: string; lastError?: string; restarts: number }) => void,
    ) {}

    async ensureUp(): Promise<WorkerClient> {
        if (this.client !== undefined && this.child?.exitCode === null) return this.client;
        this.starting ??= this.start().finally(() => {
            this.starting = undefined;
        });
        return this.starting;
    }

    private async start(): Promise<WorkerClient> {
        if (this.restarts >= this.options.maxRestarts) {
            throw new RhapsodeError(
                'model_unavailable',
                `engine "${this.id}" has failed to stay up ${this.restarts} times; ${this.lastError ?? 'no further detail'}`,
            );
        }

        this.wanted = true;
        this.onState({ process: 'starting', restarts: this.restarts });

        const socketPath = await this.allocateSocket();
        const { command, args } = resolveCommand(this.entry);

        const child = spawn(command, args, {
            cwd: this.entry.cwd,
            // Constructed, not inherited. An engine's virtualenv must not see the core's PYTHONPATH
            // or VIRTUAL_ENV, or it imports the wrong torch and the failure is baffling.
            env: {
                PATH: process.env.PATH ?? '',
                HOME: process.env.HOME ?? '',
                LANG: process.env.LANG ?? 'C.UTF-8',
                TMPDIR: process.env.TMPDIR ?? tmpdir(),
                ...(this.options.voiceDir === undefined ? {} : { RHAPSODE_VOICE_DIR: join(this.options.voiceDir, this.id) }),
                ...this.entry.env,
                [WORKER_ENV.listen]: `unix:${socketPath}`,
                [WORKER_ENV.engine]: this.id,
                [WORKER_ENV.contract]: String(CONTRACT_MAJOR),
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        this.child = child;
        this.socketPath = socketPath;
        this.forwardStderr(child);
        child.once('exit', (code, signal) => this.onExit(code, signal));
        // A permanent listener, so that an `error` after startup is logged rather than thrown. An
        // EventEmitter with no `error` listener rethrows, and this one belongs to a child process
        // whose problems are not the core's to die of.
        child.on('error', error => this.logger.warn('worker process error', { engine: this.id, error }));

        const handshake = await this.awaitHandshake(child);
        this.checkContract(handshake);

        this.client = new WorkerClient({ socketPath });
        this.upSince = DateTime.utc();
        this.onState({ process: 'up', restarts: this.restarts });
        this.logger.info('worker up', { engine: this.id, pid: child.pid, listen: handshake.listen });
        return this.client;
    }

    /**
     * Race the one line against the two other ways starting can end.
     *
     * A worker that exits before printing has failed to start, and its stderr is the error message.
     * That is the mechanism; the timeout is only a backstop. Polling instead is how you end up
     * waiting two minutes to find out a worker died on an import error, because a dead worker and a
     * slow one look identical to a poll loop.
     */
    private async awaitHandshake(child: ChildProcess): Promise<Handshake> {
        const lines = createInterface({ input: child.stdout!, crlfDelay: Infinity });
        let exitDuringStartup: ((code: number | null) => void) | undefined;
        let spawnFailed: ((error: Error) => void) | undefined;
        let timer: NodeJS.Timeout | undefined;

        try {
            return await new Promise<Handshake>((resolve, reject) => {
                timer = setTimeout(() => {
                    reject(new RhapsodeError('model_unavailable', `engine "${this.id}" did not announce itself in time`));
                }, this.options.startupTimeoutSeconds * 1000);
                timer.unref();

                lines.once('line', line => {
                    try {
                        const parsed = JSON.parse(line) as Handshake;
                        if (parsed.ready !== true) throw new Error('the line did not say ready');
                        resolve(parsed);
                    } catch (error) {
                        reject(
                            new RhapsodeError('internal', `engine "${this.id}" printed something that is not a handshake: ${line}`, {
                                cause: error,
                            }),
                        );
                    }
                });

                exitDuringStartup = code => {
                    // The whole of stderr goes to the log, where an operator will look. What goes
                    // to the client is one line: a stack trace from somebody else's virtualenv is
                    // not something a caller can act on, and a multi-kilobyte error body for a
                    // failure to start is its own small denial of service.
                    this.logger.error('worker failed to start', {
                        engine: this.id,
                        code,
                        stderr: this.stderrRing.join('\n'),
                    });
                    reject(
                        new RhapsodeError(
                            'model_unavailable',
                            `engine "${this.id}" exited ${code} before announcing itself: ${summarise(this.stderrRing)}`,
                        ),
                    );
                };
                child.once('exit', exitDuringStartup);

                // A command that does not exist never runs and never exits: it emits `error`. With
                // nothing listening that is an uncaught exception, which takes the whole core down
                // because one engine's venv path is wrong. It is also the difference between
                // failing now and failing when the startup timeout eventually gives up.
                spawnFailed = error => {
                    reject(new RhapsodeError('model_unavailable', `engine "${this.id}" could not be started: ${error.message}`, { cause: error }));
                };
                child.once('error', spawnFailed);
            });
        } finally {
            // Both of these outlive the promise if they are not removed, and the exit listener is
            // the one that matters: left attached, it fires when the worker is stopped on purpose
            // hours later and logs a startup failure that did not happen.
            clearTimeout(timer);
            if (exitDuringStartup !== undefined) child.removeListener('exit', exitDuringStartup);
            if (spawnFailed !== undefined) child.removeListener('error', spawnFailed);
            lines.close();
            // Anything further on stdout is a bug in somebody's adapter rather than a reason to
            // kill it, but it is worth seeing.
            child.stdout?.on('data', chunk => this.logger.warn(String(chunk).trim(), { engine: this.id, source: 'stdout' }));
        }
    }

    private checkContract(handshake: Handshake): void {
        if (typeof handshake.contract !== 'number' || handshake.contract > CONTRACT_MAJOR) {
            throw new RhapsodeError(
                'unsupported',
                `engine "${this.id}" speaks contract ${handshake.contract}; this core supports up to ` +
                    `${CONTRACT_MAJOR}. Upgrade rhapsode or pin the engine.`,
            );
        }
        if (handshake.engine !== this.id) {
            throw new RhapsodeError('internal', `engine "${this.id}" announced itself as "${handshake.engine}", so the catalog entry is wrong`);
        }
    }

    /**
     * Forward what the worker says, and keep what it is not able to structure.
     *
     * torch, transformers and CUDA all write warnings to stderr that the SDK never sees, and those
     * are exactly the lines an operator needs when a load fails. Dropping anything unparseable
     * would throw them away.
     */
    private forwardStderr(child: ChildProcess): void {
        const lines = createInterface({ input: child.stderr!, crlfDelay: Infinity });
        lines.on('line', line => {
            this.stderrRing.push(line);
            if (this.stderrRing.length > STDERR_RING_LINES) this.stderrRing.shift();

            const record = parseJsonLine(line);
            if (record === undefined) {
                this.logger.warn(line, { engine: this.id });
                return;
            }

            const level = LEVEL_NAMES.has(String(record.level)) ? String(record.level) : 'info';
            const { level: _level, message, ...fields } = record;
            // The engine id is a structured field rather than something interpolated into the text,
            // because interpolated data cannot be filtered on afterwards.
            call(this.logger, level, String(message ?? line), { ...fields, engine: this.id });
        });
    }

    private onExit(code: number | null, signal: NodeJS.Signals | null): void {
        this.client?.close().catch(() => {});
        this.client = undefined;
        this.socketPath = undefined;

        if (!this.wanted) {
            this.onState({ process: 'down', restarts: this.restarts });
            return;
        }

        // The restart count is held against it, and decays only after the worker has been up
        // continuously. A worker that crashes on every third synthesis should climb rather than
        // reset, or the circuit never opens.
        const stableFor = this.upSince?.diffNow().negate().as('seconds') ?? 0;
        if (stableFor > this.options.restartDecaySeconds) this.restarts = 0;

        this.restarts += 1;
        this.lastError = `exited ${code ?? signal}: ${summarise(this.stderrRing)}`;
        this.onState({
            process: this.restarts >= this.options.maxRestarts ? 'failed' : 'down',
            lastError: this.lastError,
            restarts: this.restarts,
        });
        this.logger.warn('worker exited', { engine: this.id, code, signal, restarts: this.restarts });
    }

    async stop(reason: 'shutdown' | 'evict' | 'uninstall'): Promise<void> {
        this.wanted = false;
        const child = this.child;

        if (child === undefined || child.exitCode !== null) {
            await this.client?.close();
            this.client = undefined;
            await this.cleanupSocket();
            return;
        }

        this.logger.info('stopping worker', { engine: this.id, reason });
        const exited = once(child, 'exit');
        const kill = setTimeout(() => child.kill('SIGKILL'), this.options.drainGraceMs);
        kill.unref();

        try {
            // An eviction reaches for the verb first, because that is the one reclaim a remote
            // worker can also be given: a core that only signals silently degrades to `unload` over
            // TCP and loses the 30% an unload strands. § 3. A shutdown keeps signalling, which § 2
            // describes as the same sequence, and a worker too wedged to answer gets it anyway.
            if (!(reason === 'evict' && (await this.askToTerminate()))) child.kill('SIGTERM');
            await exited;
        } finally {
            clearTimeout(kill);
            await this.client?.close();
            this.client = undefined;
            this.child = undefined;
            await this.cleanupSocket();
        }
    }

    /** Whether the worker accepted "end your own process". The signal is the answer when it did not. */
    private async askToTerminate(): Promise<boolean> {
        const client = this.client;
        if (client === undefined) return false;
        try {
            await client.terminate();
            return true;
        } catch (error) {
            this.logger.warn('the terminate verb did not land; signalling instead', { engine: this.id, error });
            return false;
        }
    }

    private async allocateSocket(): Promise<string> {
        const directory = this.options.socketDir ?? join(tmpdir(), `rhapsode-${process.getuid?.() ?? 0}`);
        await mkdir(directory, { recursive: true, mode: 0o700 });

        // The random suffix stops a restarted worker colliding with a socket its predecessor has
        // not finished releasing.
        const path = join(directory, `${this.id}.${randomBytes(4).toString('hex')}.sock`);
        if (path.length > MAX_SOCKET_PATH) {
            throw new RhapsodeError(
                'internal',
                `the socket path for "${this.id}" is ${path.length} characters and the platform limit is ` +
                    `about ${MAX_SOCKET_PATH}. Set workers.socketDir to something shorter, such as /run/rhapsode.`,
            );
        }
        await unlink(path).catch(() => {});
        return path;
    }

    private async cleanupSocket(): Promise<void> {
        if (this.socketPath === undefined) return;
        await unlink(this.socketPath).catch(() => {});
        this.socketPath = undefined;
    }
}

/** One escape hatch, one convention, nothing clever. */
export function resolveCommand(entry: EngineEntry): { command: string; args: string[] } {
    if (entry.command !== undefined) return { command: entry.command, args: entry.args ?? [] };
    if (entry.venv === undefined || entry.module === undefined) {
        throw new RhapsodeError('internal', `engine "${entry.id}" has neither a command nor a venv and module to derive one from`);
    }
    const binary = process.platform === 'win32' ? join(entry.venv, 'Scripts', 'python.exe') : join(entry.venv, 'bin', 'python');
    return { command: binary, args: ['-m', entry.module] };
}

interface Handshake {
    ready: boolean;
    contract: number;
    engine: string;
    listen: string;
}

const LEVEL_NAMES = new Set(['error', 'warn', 'info', 'debug', 'trace']);

function parseJsonLine(line: string): Record<string, unknown> | undefined {
    if (!line.startsWith('{')) return undefined;
    try {
        const parsed: unknown = JSON.parse(line);
        return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined;
    } catch {
        return undefined;
    }
}

function call(logger: Logger, level: string, message: string, fields: Record<string, unknown>): void {
    const method = (logger as unknown as Record<string, (m: string, f: unknown) => void>)[level];
    if (typeof method === 'function') method.call(logger, message, fields);
    else logger.info(message, fields);
}

/**
 * The last thing a dying worker said, in one line a caller can read.
 *
 * Prefers the `message` out of a structured line, because the SDK writes JSON and the useful part is
 * buried inside it: an operator reading an error body should not have to parse a log record.
 */
function summarise(stderr: string[]): string {
    for (const line of [...stderr].reverse()) {
        const record = parseJsonLine(line);
        const message = record?.message;
        if (typeof message === 'string' && message.length > 0) return message;
        if (record === undefined && line.trim().length > 0) return line.trim().slice(0, 300);
    }
    return 'it said nothing on stderr';
}
