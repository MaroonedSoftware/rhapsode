import { useEffect, useRef } from 'react';
import { Alert, Badge, Card, Code, Group, Loader, ScrollArea, Stack, Stepper, Text, Title, VisuallyHidden } from '@mantine/core';
import type { InstallJob } from '@maroonedsoftware/rhapsode-sdk';

import { useCatalog } from '../../api/catalog.queries';
import { useInstallJob } from '../../api/installs.queries';
import { useJobFeed } from '../../api/job.feed';
import { useEngineName } from '../shared/engine.name';
import { ErrorAlert } from '../shared/error.alert';
import { severityColor } from '../shared/status';
import { isNothingToFetch, jobBadge } from './job.state';
import { WarmOffer } from './warm.offer';

// Labels only: with a description each, four steps wrap onto two lines in the panel's width and
// read as a grid. The descriptions went into the tooltip of each step, which only a mouse can
// reach, so the running step's description is also written out under the stepper.
type Step = { step: NonNullable<InstallJob['step']>; label: string; hint: string };

const WEIGHTS: Step = { step: 'weights', label: 'Weights', hint: 'Downloaded, not loaded' };
const WARM: Step = { step: 'warm', label: 'Warm', hint: 'Loaded once so it compiles now, then unloaded' };
const INSTALL: Step[] = [
    { step: 'venv', label: 'Virtualenv', hint: 'Its own, so its dependencies cannot break another engine' },
    { step: 'packages', label: 'Packages', hint: 'The adapter and what it needs' },
    { step: 'verify', label: 'Verify', hint: 'Imported by the interpreter that will run it' },
    { step: 'register', label: 'Register', hint: 'Available without a restart' },
];

/**
 * An install that names a variant downloads it as a fifth step, and warms it as a sixth when it
 * compiles; a reinstall warms after its fourth what the install warmed. Whether a variant compiles
 * is the worker's to say, so the step is shown once the job reaches it. protocol.md § 10.
 */
function stepsOf(job: InstallJob, current: string | undefined): Step[] {
    if (job.kind === 'pull') return [WEIGHTS];
    if (job.kind === 'warm') return [WARM];
    const warm = current === 'warm' ? [WARM] : [];
    if (job.kind === 'reinstall') return [...INSTALL, ...warm];
    return job.variant === undefined ? INSTALL : [...INSTALL, WEIGHTS, ...warm];
}

/** A job's name, in the tense its state calls for. `name` is the engine's display name where known. */
export function jobTitle(job: InstallJob, name = job.engine): string {
    const doing = job.state === 'queued' || job.state === 'running';
    if (job.kind === 'install') return `${doing ? 'Installing' : 'Install'} ${name}`;
    if (job.kind === 'reinstall') return `${doing ? 'Reinstalling' : 'Reinstall'} ${name}`;
    if (job.kind === 'warm') return `${doing ? 'Warming' : 'Warm'} ${`${name} ${job.variant ?? ''}`.trim()}`;
    return `${doing ? 'Downloading' : 'Download'} ${`${name} ${job.variant ?? ''}`.trim()}`;
}

/** Every step a job can be at, for naming the one a failure stopped on. */
const ALL_STEPS = [...INSTALL, WEIGHTS, WARM];

/** "Failed at the packages step", in the stepper's words rather than the protocol's `venv`. */
function failedAt(current: string | undefined): string {
    const step = ALL_STEPS.find(entry => entry.step === current);
    if (step !== undefined) return `Failed at the ${step.label.toLowerCase()} step`;
    return current === undefined ? 'Failed at the start' : `Failed at ${current}`;
}

const SUCCEEDED: Record<InstallJob['kind'], string> = { install: 'Installed', reinstall: 'Reinstalled', pull: 'Downloaded', warm: 'Warmed' };

/** One job, followed as it happens: which step, what it printed, and how it ended. */
export function JobPanel({ jobId, onWarm }: { jobId: string; onWarm?: (engine: string, variant: string) => void }) {
    const job = useInstallJob(jobId);
    const catalog = useCatalog();
    const feed = useJobFeed(jobId);
    const engineName = useEngineName();
    const viewport = useRef<HTMLDivElement>(null);

    // Follow the newest line, the way a terminal does.
    useEffect(() => {
        viewport.current?.scrollTo({ top: viewport.current.scrollHeight });
    }, [feed.lines.length]);

    if (job.isError) return <ErrorAlert title="That job could not be read" error={job.error} fallback="The server did not answer." />;
    if (job.data === undefined) return <Loader size="sm" aria-label="Reading the job" />;

    const data = job.data;
    const name = engineName(data.engine);
    const title = jobTitle(data, name);
    const current = feed.progress?.phase ?? data.step;
    const steps = stepsOf(data, current);
    const warmed = current === 'warm';
    const index = steps.findIndex(entry => entry.step === current);
    const finished = data.state === 'succeeded' || data.state === 'failed';
    const active = data.state === 'succeeded' ? steps.length : Math.max(0, index);
    const badge = jobBadge(data);
    const noFetch = isNothingToFetch(data);
    const reinstalled = data.state === 'succeeded' ? catalog.data?.find(entry => entry.id === data.engine) : undefined;
    const running = finished ? undefined : steps[index];
    // What a screen reader hears as the job moves: the step while it runs, the outcome once it ends.
    // The stepper changes only its colours, which a screen reader does not announce.
    const announcement = finished ? `${title}: ${badge.label}` : running === undefined ? '' : `${title}: ${running.label}`;

    return (
        <Card>
            <Stack gap="md">
                <Group justify="space-between" wrap="nowrap">
                    <Title order={2} size="h4">
                        {title}
                    </Title>
                    <Group gap="xs" wrap="nowrap">
                        {feed.live && !finished ? <Loader size="xs" /> : undefined}
                        <Badge variant="light" color={badge.color}>
                            {badge.label}
                        </Badge>
                    </Group>
                </Group>

                {steps.length > 1 ? (
                    <Stepper active={active} size="sm" color={data.state === 'failed' ? 'red' : undefined}>
                        {steps.map(entry => (
                            <Stepper.Step key={entry.step} label={entry.label} title={entry.hint} />
                        ))}
                    </Stepper>
                ) : undefined}
                {running !== undefined && steps.length > 1 ? (
                    <Text size="sm" c="dimmed">
                        {running.label}: {running.hint.charAt(0).toLowerCase() + running.hint.slice(1)}.
                    </Text>
                ) : undefined}
                <VisuallyHidden role="status" aria-live="polite">
                    {announcement}
                </VisuallyHidden>

                {data.state === 'succeeded' ? (
                    <Alert color={severityColor.success} title={SUCCEEDED[data.kind]}>
                        {data.kind === 'pull'
                            ? `The ${data.variant ?? 'default'} weights are on this machine, so the first request only has to load them.`
                            : data.kind === 'warm'
                              ? `${name} ${data.variant ?? ''} is compiled, so its first request loads it from the cache.`
                              : data.kind === 'reinstall'
                                ? `${name} now runs from a virtualenv this server built. Its next request loads the model again${warmed ? ', from the compile cache this filled' : ''}.`
                                : data.variant === undefined
                                  ? `${name} is ready. Its first request loads the model, and downloads the weights if they are not here yet.`
                                  : warmed
                                    ? `${name} is ready, with the ${data.variant} weights on this machine and compiled, so its first request loads them from the cache.`
                                    : `${name} is ready, with the ${data.variant} weights on this machine, so its first request only has to load them.`}
                        {/* A reinstall warms only what was recorded, and its old worker is gone, so the card cannot see this. § 10. */}
                        {data.kind === 'reinstall' && onWarm !== undefined && reinstalled !== undefined ? (
                            <Group mt="xs">
                                <WarmOffer entry={reinstalled} ask onWarm={variant => onWarm(data.engine, variant)} />
                            </Group>
                        ) : undefined}
                    </Alert>
                ) : noFetch ? (
                    <Alert color={severityColor.info} title="Nothing to download ahead of time">
                        {name} does not download weights ahead of time. They arrive with its first request instead.
                    </Alert>
                ) : data.state === 'failed' ? (
                    <ErrorAlert title={failedAt(current)} fallback="The job failed and said nothing.">
                        {data.error?.message}
                        {/* A reinstall swaps only once its new virtualenv works, so a failure left the old one running. § 10. */}
                        {data.kind === 'reinstall' && !warmed ? ` ${name} is still running from its previous virtualenv.` : undefined}
                        {/* A warm comes after the swap or the download, so all that failed is one load. § 10. */}
                        {warmed
                            ? data.kind === 'warm'
                                ? ` Nothing else about ${name} changed; its first request tries that load again.`
                                : ` ${name} is ${data.kind === 'reinstall' ? 'reinstalled' : 'installed with its weights'}; its first request tries that load again.`
                            : undefined}
                        {/* The engine was registered before its weights were asked for, so it is installed. § 10. */}
                        {data.kind === 'install' && current === 'weights'
                            ? ` ${name} is installed; download the weights again from its card.`
                            : undefined}
                    </ErrorAlert>
                ) : undefined}

                {feed.lines.length > 0 ? (
                    <ScrollArea
                        h={220}
                        viewportRef={viewport}
                        type="auto"
                        // Focusable, so a keyboard can scroll back through what it printed.
                        viewportProps={{ tabIndex: 0, 'aria-label': 'Job output' }}
                    >
                        <Code block style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>
                            {feed.lines.join('\n')}
                        </Code>
                    </ScrollArea>
                ) : finished ? undefined : (
                    <Text size="sm" c="dimmed">
                        {data.state === 'queued' ? 'Waiting for the job ahead of it.' : 'Starting…'}
                    </Text>
                )}
            </Stack>
        </Card>
    );
}
