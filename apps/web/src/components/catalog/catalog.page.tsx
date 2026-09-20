import { useState } from 'react';
import { Button, Card, Grid, SimpleGrid, Stack, Title } from '@mantine/core';
import { IconDownload, IconPackage, IconTrash } from '@tabler/icons-react';
import type { CatalogEntry, InstallJob } from '@maroonedsoftware/rhapsode-sdk';

import { useCatalog } from '../../api/catalog.queries';
import { useInstallEngine, useInstallJobs, usePullEngine, useUninstallEngine } from '../../api/installs.queries';
import { apiErrorCode } from '../../api/sdk.error';
import { InstallModal } from '../installs/install.modal';
import { JobPanel } from '../installs/job.panel';
import { JobsList } from '../installs/jobs.list';
import { ConfirmModal } from '../shared/confirm.modal';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
import { notifyFailure, notifySuccess } from '../shared/notify';
import { PageHeader } from '../shared/page.header';
import { PageSkeleton } from '../shared/page.skeleton';
import { EngineCard } from './engine.card';
import { LoadedModels } from './loaded.models';

/** Every engine that exists, with both licences, which of them this box has, and the means to change that. */
export function CatalogPage() {
    const catalog = useCatalog();
    const jobs = useInstallJobs();
    const install = useInstallEngine();
    const pull = usePullEngine();
    const uninstall = useUninstallEngine();

    const [installing, setInstalling] = useState<CatalogEntry | undefined>(undefined);
    const [removing, setRemoving] = useState<CatalogEntry | undefined>(undefined);
    const [watching, setWatching] = useState<string | undefined>(undefined);

    // The job list is a management route and the catalog is not, so a page opened from another
    // machine can read the catalog and be refused this. That refusal is the whole answer to "why
    // are there no buttons", so it is said once, here, rather than on every button.
    const managed = !(jobs.isError && apiErrorCode(jobs.error) === 'forbidden');
    const pending = (engine: string): InstallJob | undefined =>
        jobs.data?.find(job => job.engine === engine && (job.state === 'queued' || job.state === 'running'));
    const shown = watching ?? jobs.data?.[0]?.id;

    const confirmInstall = (pull: string | undefined) => {
        if (installing === undefined) return;
        install.mutate(
            { engine: installing.id, ...(pull === undefined ? {} : { pull }) },
            {
                onSuccess: job => {
                    setInstalling(undefined);
                    setWatching(job.id);
                },
            },
        );
    };

    const startPull = (entry: CatalogEntry) =>
        pull.mutate(
            { engine: entry.id, ...(entry.defaultVariant === undefined ? {} : { variant: entry.defaultVariant }) },
            {
                onSuccess: job => setWatching(job.id),
                onError: error => notifyFailure(`Downloading ${entry.displayName} did not start`, error, 'The server did not answer.'),
            },
        );

    const confirmRemove = () => {
        if (removing === undefined) return;
        const name = removing.displayName;
        uninstall.mutate(removing.id, {
            onSuccess: () => {
                setRemoving(undefined);
                notifySuccess(`${name} was uninstalled. Its downloaded weights are still on this machine.`);
            },
        });
    };

    const actions = (entry: CatalogEntry) => {
        if (!managed) return undefined;
        const busy = pending(entry.id);
        if (busy !== undefined) {
            return (
                <Button variant="light" size="xs" onClick={() => setWatching(busy.id)}>
                    Show progress
                </Button>
            );
        }
        if (entry.installed === 'no') {
            return (
                <Button
                    size="xs"
                    leftSection={<IconPackage size={14} />}
                    onClick={() => {
                        install.reset();
                        setInstalling(entry);
                    }}
                >
                    Install
                </Button>
            );
        }
        return (
            <>
                {entry.defaultVariant === undefined ? undefined : (
                    <Button
                        variant="light"
                        size="xs"
                        leftSection={<IconDownload size={14} />}
                        loading={pull.isPending && pull.variables?.engine === entry.id}
                        onClick={() => startPull(entry)}
                    >
                        Download {entry.defaultVariant} weights
                    </Button>
                )}
                {/* Only what this page installed. An engine configured by hand is the operator's to remove. */}
                {entry.managed ? (
                    <Button
                        variant="subtle"
                        color="red"
                        size="xs"
                        leftSection={<IconTrash size={14} />}
                        onClick={() => {
                            uninstall.reset();
                            setRemoving(entry);
                        }}
                    >
                        Uninstall
                    </Button>
                ) : undefined}
            </>
        );
    };

    return (
        <Stack gap="lg">
            <PageHeader
                title="Engines"
                description="Every engine rhapsode knows about, with the licence for its code and, separately, for its weights."
            />
            {managed ? undefined : <ErrorAlert tone="info" title="Installing is only for the machine running rhapsode" error={jobs.error} />}
            {catalog.isPending ? (
                <PageSkeleton variant="card" />
            ) : catalog.isError ? (
                <ErrorAlert title="The catalog did not load" error={catalog.error} fallback="The rhapsode server did not answer." />
            ) : catalog.data.length === 0 ? (
                <EmptyState title="No engines">This rhapsode knows about no engines, which means its catalog is empty.</EmptyState>
            ) : (
                <SimpleGrid cols={{ base: 1, md: 2 }}>
                    {catalog.data.map(entry => (
                        <EngineCard key={entry.id} entry={entry} actions={actions(entry)} />
                    ))}
                </SimpleGrid>
            )}

            <LoadedModels />

            {managed && jobs.data !== undefined && jobs.data.length > 0 && shown !== undefined ? (
                <Stack gap="sm">
                    <Title order={2} size="h3">
                        Jobs
                    </Title>
                    <Grid>
                        <Grid.Col span={{ base: 12, md: 4 }}>
                            <Card padding="xs">
                                <JobsList jobs={jobs.data} selected={shown} onSelect={setWatching} />
                            </Card>
                        </Grid.Col>
                        <Grid.Col span={{ base: 12, md: 8 }}>
                            <JobPanel key={shown} jobId={shown} />
                        </Grid.Col>
                    </Grid>
                </Stack>
            ) : undefined}

            <InstallModal
                // Keyed, so the next engine's dialog starts with the download ticked again.
                key={installing?.id}
                entry={installing}
                onClose={() => setInstalling(undefined)}
                onConfirm={confirmInstall}
                installing={install.isPending}
                error={install.error ?? undefined}
            />
            <ConfirmModal
                opened={removing !== undefined}
                onClose={() => setRemoving(undefined)}
                onConfirm={confirmRemove}
                title={removing ? `Uninstall ${removing.displayName}?` : ''}
                confirmLabel="Uninstall"
                confirming={uninstall.isPending}
                error={uninstall.error ?? undefined}
            >
                Its worker is stopped and its virtualenv deleted. Downloaded weights stay where the engine put them, because other tools on this
                machine may share that cache.
            </ConfirmModal>
        </Stack>
    );
}
