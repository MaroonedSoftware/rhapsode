import { randomUUID } from 'node:crypto';

import { Logger } from '@maroonedsoftware/logger';
import type { ServerFeed } from '@maroonedsoftware/serverfeed';
import type { InstallJob } from '@rhapsode/contract';
import { DateTime } from 'luxon';

import { asRhapsodeError, RhapsodeError } from '../errors/rhapsode.error.js';
import { Mutex } from '../residency/mutex.js';
import type { InstallStep } from './install.plan.js';

/** The feed source every job event is published under. */
export const INSTALL_SOURCE = 'install';

/** Finished jobs kept for reading back. Enough for a session at a terminal; it is not a history. */
const KEPT = 50;

const INSTALL_STEPS: InstallStep[] = ['venv', 'packages', 'verify', 'register'];

/** An install asked for weights has a fifth step, and a job's variant is how it was asked. § 10. */
function stepsOf(job: InstallJob): InstallStep[] {
    if (job.kind === 'pull') return ['weights'];
    return job.variant === undefined ? INSTALL_STEPS : [...INSTALL_STEPS, 'weights'];
}

/** What a job's work is given: somewhere to report, and a signal that fires on shutdown. */
export interface JobContext {
    job: Readonly<InstallJob>;
    step(step: InstallStep): void;
    line(line: string): void;
    signal: AbortSignal;
}

/**
 * Install and pull jobs, run one at a time.
 *
 * One at a time because two pip installs racing for one disk and one connection finish later than
 * the same two in a line, and a failure in one is easier to read without the other interleaved
 * through it. In memory because a restart that forgot a job loses nothing: the install it was
 * running left a virtualenv that step one of the next install removes. protocol.md § 10.
 */
export class InstallJobs {
    private readonly jobs = new Map<string, InstallJob>();
    private readonly queue = new Mutex();
    private readonly stopping = new AbortController();

    constructor(
        readonly feed: ServerFeed,
        private readonly logger: Logger,
    ) {}

    list(): InstallJob[] {
        return [...this.jobs.values()].reverse().map(job => ({ ...job }));
    }

    get(id: string): InstallJob | undefined {
        const job = this.jobs.get(id);
        return job === undefined ? undefined : { ...job };
    }

    /** A job for this engine that has not finished, of either kind. */
    pending(engine: string): InstallJob | undefined {
        return [...this.jobs.values()].find(job => job.engine === engine && (job.state === 'queued' || job.state === 'running'));
    }

    submit(kind: InstallJob['kind'], engine: string, variant: string | undefined, work: (context: JobContext) => Promise<void>): InstallJob {
        if (this.stopping.signal.aborted) throw new RhapsodeError('overloaded', 'the server is shutting down');

        const job: InstallJob = {
            id: randomUUID(),
            engine,
            kind,
            ...(variant === undefined ? {} : { variant }),
            state: 'queued',
            createdAt: DateTime.utc().toISO(),
        };
        this.jobs.set(job.id, job);
        this.prune();
        this.feed.status(INSTALL_SOURCE, job.id, `${kind} ${engine} queued`);

        void this.queue.run(() => this.execute(job, work));
        return { ...job };
    }

    /** Refuse new jobs, stop the running one, and wait for the queue to empty. */
    async stop(): Promise<void> {
        this.stopping.abort(new Error('the server is shutting down'));
        await this.queue.run(async () => {});
    }

    private async execute(job: InstallJob, work: (context: JobContext) => Promise<void>): Promise<void> {
        const steps = stepsOf(job);
        job.state = 'running';
        job.startedAt = DateTime.utc().toISO();
        this.logger.info('install job started', { job: job.id, kind: job.kind, engine: job.engine });

        const context: JobContext = {
            job,
            signal: this.stopping.signal,
            step: step => {
                job.step = step;
                this.feed.progress(INSTALL_SOURCE, job.id, { phase: step, index: steps.indexOf(step) + 1, total: steps.length, status: 'running' });
            },
            line: line => {
                this.feed.publish({ source: INSTALL_SOURCE, level: 'info', kind: 'log', message: line, correlationId: job.id });
            },
        };

        try {
            this.stopping.signal.throwIfAborted();
            await work(context);
            job.state = 'succeeded';
            this.feed.progress(INSTALL_SOURCE, job.id, { phase: job.step ?? 'done', index: steps.length, total: steps.length, status: 'done' });
            this.feed.status(INSTALL_SOURCE, job.id, `${job.kind} ${job.engine} succeeded`);
            this.logger.info('install job succeeded', { job: job.id, kind: job.kind, engine: job.engine });
        } catch (error) {
            const failure = this.stopping.signal.aborted
                ? new RhapsodeError('internal', 'stopped by server shutdown', { cause: error })
                : asRhapsodeError(error);
            job.state = 'failed';
            job.error = failure.envelope().error;
            this.feed.progress(INSTALL_SOURCE, job.id, {
                phase: job.step ?? 'queued',
                index: job.step === undefined ? 0 : steps.indexOf(job.step) + 1,
                total: steps.length,
                status: 'failed',
            });
            this.feed.reportError(INSTALL_SOURCE, failure, job.id);
            this.logger.warn('install job failed', { job: job.id, kind: job.kind, engine: job.engine, error: failure.message });
        } finally {
            job.finishedAt = DateTime.utc().toISO();
        }
    }

    private prune(): void {
        const finished = [...this.jobs.values()].filter(job => job.state === 'succeeded' || job.state === 'failed');
        for (const job of finished.slice(0, Math.max(0, finished.length - KEPT))) this.jobs.delete(job.id);
    }
}
