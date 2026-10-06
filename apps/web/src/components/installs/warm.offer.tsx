import { Button } from '@mantine/core';
import { IconFlame } from '@tabler/icons-react';
import type { Capabilities, CatalogEntry } from '@maroonedsoftware/rhapsode-sdk';

import { useCapabilities } from '../../api/engines.queries';

/** What warming costs, said before it is asked for. protocol.md § 10. */
export const WARM_COST =
    'It loads once and unloads, taking a slot on the card and evicting an idle model if it needs one, and downloads its weights first if they are not on this machine.';

/**
 * The variants that compile on their first load and have not been warmed: the capability document
 * says which compile and the catalog what was warmed, since only the worker knows the one and only
 * the core records the other. § 10.
 */
export function unwarmed(entry: Pick<CatalogEntry, 'warmed'>, capabilities: Pick<Capabilities, 'variants'>): string[] {
    const warmed = new Set(entry.warmed ?? []);
    return Object.entries(capabilities.variants)
        .filter(([name, variant]) => variant.compiles === true && !warmed.has(name))
        .map(([name]) => name);
}

export interface WarmOfferProps {
    entry: CatalogEntry;
    /**
     * Whether to read the capability document at all. Reading it starts the worker if it is not
     * running, so the catalog asks only of a worker already up: a card per engine asking on every
     * page load is the tens of megabytes apiece § 10 keeps out of the catalog itself.
     */
    ask: boolean;
    onWarm: (variant: string) => void;
}

/** "Warm full", for the first variant of an installed engine left to warm, or nothing. */
export function WarmOffer({ entry, ask, onWarm }: WarmOfferProps) {
    // Only what this API installed records a warm, so an engine configured by hand would be offered forever.
    const capabilities = useCapabilities(ask && entry.managed && entry.installed === 'yes' ? entry.id : undefined);
    const variant = capabilities.data === undefined ? undefined : unwarmed(entry, capabilities.data)[0];
    if (variant === undefined) return undefined;
    return (
        <Button variant="light" size="xs" leftSection={<IconFlame size={14} />} onClick={() => onWarm(variant)}>
            Warm {variant}
        </Button>
    );
}
