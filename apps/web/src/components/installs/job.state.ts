import type { InstallJob } from '@maroonedsoftware/rhapsode-sdk';

import { severityColor } from '../shared/status';

/** How a job's state is named and coloured, everywhere a job is shown. */
export const JOB_STATE: Readonly<Record<InstallJob['state'], { label: string; color: string }>> = {
    queued: { label: 'Queued', color: 'gray' },
    running: { label: 'Running', color: 'blue' },
    succeeded: { label: 'Done', color: severityColor.success },
    failed: { label: 'Failed', color: severityColor.failure },
};

/**
 * A pull of an engine that does not fetch ahead of time. The core reports it as a failed job with
 * `unsupported`, which is accurate about the job and wrong about the engine: nothing is broken, the
 * weights just arrive with its first request. So it is shown as not needed, in grey, everywhere.
 */
export function isNothingToFetch(job: InstallJob): boolean {
    return job.kind === 'pull' && job.state === 'failed' && job.error?.code === 'unsupported';
}

/** The badge a job wears, in the list and in its panel alike. */
export function jobBadge(job: InstallJob): { label: string; color: string } {
    return isNothingToFetch(job) ? { label: 'Not needed', color: 'gray' } : JOB_STATE[job.state];
}
