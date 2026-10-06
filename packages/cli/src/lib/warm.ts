import type { Capabilities, CatalogEntry } from '@rhapsode/contract';

import { follow, type Ui } from './job.ui.js';
import type { ManagementClient } from './management.client.js';

/** What warming costs, said before it is asked for. protocol.md § 10. */
export const WARM_COST =
    'each loads once and unloads, taking a slot on the card and evicting an idle model if it needs one, and downloads its weights if they are not here yet';

/**
 * The variants of an installed engine that compile on their first load and have not been warmed.
 *
 * The variants that compile come from the capability document and what was warmed from the catalog,
 * because only the worker knows the first and only the core records the second. § 10.
 */
export function unwarmed(entry: Pick<CatalogEntry, 'warmed'>, capabilities: Pick<Capabilities, 'variants'>): string[] {
    const warmed = new Set(entry.warmed ?? []);
    return Object.entries(capabilities.variants)
        .filter(([name, variant]) => variant.compiles === true && !warmed.has(name))
        .map(([name]) => name);
}

/** Warm each variant in turn, following each job, and say how many failed. */
export async function warmEach(api: ManagementClient, ui: Ui, entry: Pick<CatalogEntry, 'id' | 'displayName'>, variants: string[]): Promise<number> {
    let failed = 0;
    for (const variant of variants) {
        const finished = await follow(api, await api.warm(entry.id, variant), `Warming ${entry.displayName} ${variant}`, ui);
        if (finished.state === 'failed' && finished.error?.code === 'unsupported') {
            ui.warn(`${entry.displayName} ${variant} does not compile on its first load, so there was nothing to warm.`);
        }
        if (finished.state !== 'succeeded') failed += 1;
    }
    return failed === 0 ? 0 : 1;
}
