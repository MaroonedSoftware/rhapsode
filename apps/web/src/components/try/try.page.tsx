import { Button, Select, Stack } from '@mantine/core';
import { Link, useNavigate } from '@tanstack/react-router';

import { useCatalog } from '../../api/catalog.queries';
import { useEngines } from '../../api/engines.queries';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
import { PageHeader } from '../shared/page.header';
import { PageSkeleton } from '../shared/page.skeleton';
import { TryPanel } from './try.panel';

/** Say a line with an installed engine, choosing from what its capability document says it can do. */
export function TryPage({ engine }: { engine?: string }) {
    const engines = useEngines();
    const catalog = useCatalog();
    const navigate = useNavigate();

    const installed = engines.data ?? [];
    const selected = engine !== undefined && installed.some(entry => entry.id === engine) ? engine : installed[0]?.id;
    const defaultVariant = catalog.data?.find(entry => entry.id === selected)?.defaultVariant;

    return (
        <Stack gap="lg">
            <PageHeader
                title="Try it"
                description="Say a line with an installed engine. The choices come from its capability document, so each variant offers only what it can perform."
                actions={
                    installed.length > 1 ? (
                        <Select
                            aria-label="Engine"
                            data={installed.map(entry => ({ value: entry.id, label: entry.displayName }))}
                            value={selected ?? null}
                            onChange={value => {
                                if (value) void navigate({ to: '/try', search: { engine: value } });
                            }}
                            allowDeselect={false}
                            w={200}
                        />
                    ) : undefined
                }
            />
            {engines.isPending ? (
                <PageSkeleton variant="card" />
            ) : engines.isError ? (
                <ErrorAlert title="The engines did not load" error={engines.error} fallback="The rhapsode server did not answer." />
            ) : selected === undefined ? (
                <EmptyState
                    title="No engines installed"
                    action={
                        <Button variant="light" renderRoot={(props: object) => <Link to="/" {...props} />}>
                            Install one
                        </Button>
                    }
                >
                    There is nothing to try yet. Install an engine first.
                </EmptyState>
            ) : (
                // Keyed by engine, so switching engines starts its panel afresh rather than carrying
                // one engine's dials into another's.
                <TryPanel key={selected} engine={selected} defaultVariant={defaultVariant} />
            )}
        </Stack>
    );
}
