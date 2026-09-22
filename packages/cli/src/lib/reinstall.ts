import type { CatalogEntry, ReinstallOutdated } from '@rhapsode/contract';

import { follow, type Ui } from './job.ui.js';
import type { ManagementClient } from './management.client.js';

type Client = typeof import('./management.client.js');

/** What reinstalling costs, said before it is asked for. protocol.md § 10. */
export const REINSTALL_COST = 'its next request loads the model cold, and anything installed into its virtualenv by hand is lost';

/**
 * Reinstall one engine, asking for its weights licence only if the server does.
 *
 * The client cannot know whether the licence the last install accepted still covers the weights,
 * because that is in the server's managed file, so it asks without `accept` first and takes a
 * refusal naming the query as the server saying somebody has to agree again. § 10.
 */
export async function reinstallOne(api: ManagementClient, client: Client, ui: Ui, entry: CatalogEntry): Promise<number> {
    let job;
    try {
        job = await api.reinstall(entry.id);
    } catch (error) {
        if (!(error instanceof client.ManagementError && error.code === 'bad_request' && error.message.includes('?accept='))) throw error;
        ui.info(`${entry.displayName} (${entry.package}): ${client.describeLicense(entry.license)}`);
        if (entry.license.notes !== undefined) ui.info(entry.license.notes);
        // No by default, as for install: pressing return through a prompt is not reading it.
        if (!(await ui.confirm(`The weights licence has to be accepted again. Reinstall ${entry.displayName} under it?`, false))) {
            ui.warn('Not reinstalled: pass --yes to accept the licence from a script.');
            return 1;
        }
        job = await api.reinstall(entry.id, entry.license.weights);
    }
    const finished = await follow(api, job, `Reinstalling ${entry.displayName}`, ui);
    return finished.state === 'succeeded' ? 0 : 1;
}

/** Reinstall everything behind this core, one job after another, and name what was skipped. */
export async function reinstallAll(api: ManagementClient, ui: Ui): Promise<number> {
    const answer = await api.reinstallOutdated();
    for (const skipped of answer.skipped) ui.warn(skipReason(skipped));
    if (answer.jobs.length === 0 && answer.skipped.length === 0) {
        ui.success('Nothing is behind this core.');
        return 0;
    }

    let failed = 0;
    for (const job of answer.jobs) {
        const finished = await follow(api, job, `Reinstalling ${job.engine}`, ui);
        if (finished.state !== 'succeeded') failed += 1;
    }
    return failed === 0 ? 0 : 1;
}

export function skipReason({ engine, reason }: ReinstallOutdated['skipped'][number]): string {
    switch (reason) {
        case 'licence':
            return `${engine} was left alone: its weights licence has to be accepted again. Run \`pnpm wizard reinstall ${engine}\`.`;
        case 'busy':
            return `${engine} was left alone: it already has a job queued or running.`;
        case 'uncatalogued':
            return `${engine} was left alone: the catalog no longer has it, so there is nothing to rebuild it from.`;
    }
}
