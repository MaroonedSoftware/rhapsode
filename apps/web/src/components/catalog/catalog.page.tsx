import { useState } from 'react';
import { Alert, Button, Card, Grid, Group, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { IconDownload, IconPackage, IconRefresh, IconTrash } from '@tabler/icons-react';
import type { CatalogEntry, InstallJob } from '@maroonedsoftware/rhapsode-sdk';

import { useCatalog } from '../../api/catalog.queries';
import {
    useInstallEngine,
    useInstallJobs,
    usePullEngine,
    useReinstallEngine,
    useReinstallOutdated,
    useUninstallEngine,
} from '../../api/installs.queries';
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
import { severityColor } from '../shared/status';
import { EngineCard } from './engine.card';
import { LicenseLine } from './license.line';
import { LoadedModels } from './loaded.models';

/** Every engine that exists, with both licences, which of them this box has, and the means to change that. */
export function CatalogPage() {
    const catalog = useCatalog();
    const jobs = useInstallJobs();
    const install = useInstallEngine();
    const pull = usePullEngine();
    const uninstall = useUninstallEngine();
    const reinstall = useReinstallEngine();
    const reinstallAll = useReinstallOutdated();

    const [installing, setInstalling] = useState<CatalogEntry | undefined>(undefined);
    const [removing, setRemoving] = useState<CatalogEntry | undefined>(undefined);
    const [rebuilding, setRebuilding] = useState<CatalogEntry | undefined>(undefined);
    const [watching, setWatching] = useState<string | undefined>(undefined);

    // The job list is a management route and the catalog is not, so a page opened from another
    // machine can read the catalog and be refused this. That refusal is the whole answer to "why
    // are there no buttons", so it is said once, here, rather than on every button.
    const managed = !(jobs.isError && apiErrorCode(jobs.error) === 'forbidden');
    const pending = (engine: string): InstallJob | undefined =>
        jobs.data?.find(job => job.engine === engine && (job.state === 'queued' || job.state === 'running'));
    const shown = watching ?? jobs.data?.[0]?.id;
    // The core decides what is behind; the page only counts what it was told, and only what it may rebuild.
    const behind = (catalog.data ?? []).filter(entry => entry.managed && entry.outdated === true && pending(entry.id) === undefined);

    const confirmInstall = (pull: string | undefined) => {
        if (installing === undefined) return;
        install.mutate(
            // Sent for every engine, not only those whose weights need it: the core checks it either
            // way, and it is the licence the modal put in front of the person who pressed install.
            { engine: installing.id, ...(pull === undefined ? {} : { pull }), accept: installing.license.weights },
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

    const confirmReinstall = () => {
        if (rebuilding === undefined) return;
        // The licence the dialog showed, as install sends it. The core asks for it only where what the
        // last install accepted no longer covers the weights, and checks it wherever it is sent. § 10.
        reinstall.mutate(
            { engine: rebuilding.id, accept: rebuilding.license.weights },
            {
                onSuccess: job => {
                    setRebuilding(undefined);
                    setWatching(job.id);
                },
            },
        );
    };

    const startReinstallAll = () =>
        reinstallAll.mutate(undefined, {
            onSuccess: ({ jobs: started, skipped }) => {
                if (started[0] !== undefined) setWatching(started[0].id);
                const licence = skipped.filter(entry => entry.reason === 'licence').map(entry => entry.engine);
                if (licence.length > 0) {
                    notifyFailure(
                        'Some engines were left alone',
                        undefined,
                        `${licence.join(', ')}: the weights licence has to be accepted again, so reinstall ${licence.length === 1 ? 'it' : 'each one'} from its card.`,
                    );
                }
            },
            onError: error => notifyFailure('Reinstalling did not start', error, 'The server did not answer.'),
        });

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
                {/* Only what this page installed and an upgrade left behind. A hand-configured engine is the operator's to rebuild. */}
                {entry.managed && entry.outdated === true ? (
                    <Button
                        size="xs"
                        leftSection={<IconRefresh size={14} />}
                        onClick={() => {
                            reinstall.reset();
                            setRebuilding(entry);
                        }}
                    >
                        Reinstall
                    </Button>
                ) : undefined}
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
            {managed && behind.length > 0 ? (
                <Alert
                    color={severityColor.warning}
                    title={`${behind.length === 1 ? 'One engine was' : `${behind.length} engines were`} installed by an earlier release`}
                >
                    <Group justify="space-between" align="center" gap="sm">
                        <Text size="sm" maw={640}>
                            {behind.map(entry => entry.displayName).join(', ')} still {behind.length === 1 ? 'works' : 'work'}, but never{' '}
                            {behind.length === 1 ? 'sends' : 'send'} anything added to rhapsode since. Reinstalling builds each a new virtualenv
                            beside its old one, so nothing stops working while it runs.
                        </Text>
                        <Button size="xs" leftSection={<IconRefresh size={14} />} loading={reinstallAll.isPending} onClick={startReinstallAll}>
                            Reinstall all
                        </Button>
                    </Group>
                </Alert>
            ) : undefined}
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
            <ConfirmModal
                opened={rebuilding !== undefined}
                onClose={() => setRebuilding(undefined)}
                onConfirm={confirmReinstall}
                title={rebuilding ? `Reinstall ${rebuilding.displayName}?` : ''}
                confirmLabel="Reinstall"
                confirming={reinstall.isPending}
                error={reinstall.error ?? undefined}
            >
                <Stack gap="xs">
                    <Text size="sm">
                        The server builds a new virtualenv beside the current one and switches to it once it works, so {rebuilding?.displayName} keeps
                        working until then. Its next request loads the model again, and any package installed into the old virtualenv by hand is not
                        carried over. Its weights stay where they are.
                    </Text>
                    {rebuilding === undefined || rebuilding.license.weightsCommercialUse ? undefined : (
                        <>
                            <LicenseLine license={rebuilding.license} />
                            <Text size="sm">Reinstalling accepts the weights licence as it stands now.</Text>
                        </>
                    )}
                </Stack>
            </ConfirmModal>
        </Stack>
    );
}
