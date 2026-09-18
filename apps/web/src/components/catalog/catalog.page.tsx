import { SimpleGrid, Stack } from '@mantine/core';

import { useCatalog } from '../../api/catalog.queries';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
import { PageHeader } from '../shared/page.header';
import { PageSkeleton } from '../shared/page.skeleton';
import { EngineCard } from './engine.card';

/** Every engine that exists, with both licences, and which of them this box has. */
export function CatalogPage() {
    const catalog = useCatalog();

    return (
        <Stack gap="lg">
            <PageHeader
                title="Engines"
                description="Every engine rhapsode knows about, with the licence for its code and, separately, for its weights."
            />
            {catalog.isPending ? (
                <PageSkeleton variant="card" />
            ) : catalog.isError ? (
                <ErrorAlert title="The catalog did not load" error={catalog.error} fallback="The rhapsode server did not answer." />
            ) : catalog.data.length === 0 ? (
                <EmptyState title="No engines">This rhapsode knows about no engines, which means its catalog is empty.</EmptyState>
            ) : (
                <SimpleGrid cols={{ base: 1, md: 2 }}>
                    {catalog.data.map(entry => (
                        <EngineCard key={entry.id} entry={entry} />
                    ))}
                </SimpleGrid>
            )}
        </Stack>
    );
}
