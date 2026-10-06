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

/**
 * After a reinstall, offer to warm what the engine says compiles and the core never recorded as
 * warmed. A reinstall warms only what was recorded, and an engine installed before installs warmed
 * has no record, so an upgrade's reinstall left Orpheus `full` to compile on its first request,
 * 35 s against 12. Asked only of engines just reinstalled: asking another engine starts its worker,
 * which can take seconds where it imports torch, for an answer that has not changed. § 10.
 */
export async function offerWarm(api: ManagementClient, ui: Ui, engines: string[]): Promise<number> {
    if (engines.length === 0) return 0;
    const catalog = await api.catalog();
    const left: { entry: CatalogEntry; variants: string[] }[] = [];
    for (const id of engines) {
        const entry = catalog.find(candidate => candidate.id === id);
        if (entry === undefined || !entry.managed) continue;
        const variants = unwarmed(entry, await api.capabilities(id));
        if (variants.length > 0) left.push({ entry, variants });
    }
    if (left.length === 0) return 0;

    const named = left.map(({ entry, variants }) => `${entry.displayName} ${variants.join(', ')}`).join('; ');
    if (!(await ui.confirm(`${named} compiles on its first load and has not been warmed. Warm it now? For each, ${WARM_COST}.`, true))) {
        ui.info(`Run ${left.map(({ entry }) => `\`pnpm wizard warm ${entry.id}\``).join(' and ')} when you are ready.`);
        return 0;
    }
    let failed = 0;
    for (const { entry, variants } of left) failed += await warmEach(api, ui, entry, variants);
    return failed === 0 ? 0 : 1;
}
