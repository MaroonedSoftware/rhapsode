import type { ServerFeed } from '@maroonedsoftware/serverfeed';
import { describe, expect, it } from 'vitest';

import { InstallJobs } from '../src/install/install.jobs.js';
import { RhapsodeJsonLogger } from '../src/logging/rhapsode.logger.js';

interface Progress {
    phase: string;
    index: number;
    total: number;
    status: string;
}

/** A feed that keeps the progress it was given and drops the rest. */
function recordingFeed(): { feed: ServerFeed; progress: Progress[] } {
    const progress: Progress[] = [];
    const feed = {
        progress: (_source: string, _id: string, event: Progress) => progress.push(event),
        publish: () => {},
        status: () => {},
        reportError: () => {},
    } as unknown as ServerFeed;
    return { feed, progress };
}

async function settle(jobs: InstallJobs, id: string): Promise<void> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
        const state = jobs.get(id)?.state;
        if (state === 'succeeded' || state === 'failed') return;
        await new Promise(fulfil => setTimeout(fulfil, 5));
    }
    throw new Error(`job ${id} never settled`);
}

describe('install job progress', () => {
    // Whether a job warms is the worker's answer, so the count cannot include it up front. Counted
    // from the start, an install at `warm` reported itself as step 0 of 5.
    it('counts warm once a job reaches it, so an install that warms ends at 6 of 6', async () => {
        const { feed, progress } = recordingFeed();
        const jobs = new InstallJobs(feed, new RhapsodeJsonLogger('error', () => {}));

        const job = jobs.submit('install', 'orpheus', 'full', async context => {
            for (const step of ['venv', 'packages', 'verify', 'register', 'weights', 'warm'] as const) context.step(step);
        });
        await settle(jobs, job.id);

        expect(progress.find(event => event.phase === 'warm')).toMatchObject({ index: 6, total: 6, status: 'running' });
        expect(progress.at(-1)).toMatchObject({ phase: 'warm', index: 6, total: 6, status: 'done' });
    });

    it('counts warm after a reinstall’s four steps', async () => {
        const { feed, progress } = recordingFeed();
        const jobs = new InstallJobs(feed, new RhapsodeJsonLogger('error', () => {}));

        const job = jobs.submit('reinstall', 'orpheus', undefined, async context => {
            for (const step of ['venv', 'packages', 'verify', 'register', 'warm'] as const) context.step(step);
        });
        await settle(jobs, job.id);

        expect(progress.at(-1)).toMatchObject({ phase: 'warm', index: 5, total: 5, status: 'done' });
    });
});
