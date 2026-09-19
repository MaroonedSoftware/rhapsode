import { useEffect, useRef } from 'react';
import { Alert, Badge, Card, Code, Group, Loader, ScrollArea, Stack, Stepper, Text, Title } from '@mantine/core';
import type { InstallJob } from '@maroonedsoftware/rhapsode-sdk';

import { useInstallJob } from '../../api/installs.queries';
import { useJobFeed } from '../../api/job.feed';
import { ErrorAlert } from '../shared/error.alert';
import { severityColor } from '../shared/status';
import { isNothingToFetch, jobBadge } from './job.state';

// Labels only: with a description each, four steps wrap onto two lines in the panel's width and
// read as a grid. The descriptions went into the tooltip of each step instead.
type Step = { step: NonNullable<InstallJob['step']>; label: string; hint: string };

const WEIGHTS: Step = { step: 'weights', label: 'Weights', hint: 'Downloaded, not loaded' };
const INSTALL: Step[] = [
    { step: 'venv', label: 'Virtualenv', hint: 'Its own, so its dependencies cannot break another engine' },
    { step: 'packages', label: 'Packages', hint: 'The adapter and what it needs' },
    { step: 'verify', label: 'Verify', hint: 'Imported by the interpreter that will run it' },
    { step: 'register', label: 'Register', hint: 'Available without a restart' },
];

/** An install that names a variant downloads it as a fifth step. protocol.md § 10. */
function stepsOf(job: InstallJob): Step[] {
    if (job.kind === 'pull') return [WEIGHTS];
    return job.variant === undefined ? INSTALL : [...INSTALL, WEIGHTS];
}

/** A job's name, in the tense its state calls for. */
export function jobTitle(job: InstallJob): string {
    const doing = job.state === 'queued' || job.state === 'running';
    const what = job.kind === 'install' ? job.engine : `${job.engine} ${job.variant ?? ''}`.trim();
    if (job.kind === 'install') return `${doing ? 'Installing' : 'Install'} ${what}`;
    return `${doing ? 'Downloading' : 'Download'} ${what}`;
}

/** One job, followed as it happens: which step, what it printed, and how it ended. */
export function JobPanel({ jobId }: { jobId: string }) {
    const job = useInstallJob(jobId);
    const feed = useJobFeed(jobId);
    const viewport = useRef<HTMLDivElement>(null);

    // Follow the newest line, the way a terminal does.
    useEffect(() => {
        viewport.current?.scrollTo({ top: viewport.current.scrollHeight });
    }, [feed.lines.length]);

    if (job.isError) return <ErrorAlert title="That job could not be read" error={job.error} fallback="The server did not answer." />;
    if (job.data === undefined) return <Loader size="sm" />;

    const data = job.data;
    const steps = stepsOf(data);
    const current = feed.progress?.phase ?? data.step;
    const index = steps.findIndex(entry => entry.step === current);
    const finished = data.state === 'succeeded' || data.state === 'failed';
    const active = data.state === 'succeeded' ? steps.length : Math.max(0, index);
    const badge = jobBadge(data);
    const noFetch = isNothingToFetch(data);

    return (
        <Card>
            <Stack gap="md">
                <Group justify="space-between" wrap="nowrap">
                    <Title order={2} size="h4">
                        {jobTitle(data)}
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

                {data.state === 'succeeded' ? (
                    <Alert color={severityColor.success} title={data.kind === 'install' ? 'Installed' : 'Downloaded'}>
                        {data.kind === 'pull'
                            ? `The ${data.variant ?? 'default'} weights are on this machine, so the first request only has to load them.`
                            : data.variant === undefined
                              ? `${data.engine} is ready. Its first request loads the model, and downloads the weights if they are not here yet.`
                              : `${data.engine} is ready, with the ${data.variant} weights on this machine, so its first request only has to load them.`}
                    </Alert>
                ) : noFetch ? (
                    <Alert color={severityColor.info} title="Nothing to download ahead of time">
                        {data.engine} does not download weights ahead of time. They arrive with its first request instead.
                    </Alert>
                ) : data.state === 'failed' ? (
                    <ErrorAlert title={`Failed at ${current ?? 'the start'}`} fallback="The job failed and said nothing.">
                        {data.error?.message}
                        {/* The engine was registered before its weights were asked for, so it is installed. § 10. */}
                        {data.kind === 'install' && current === 'weights'
                            ? ` ${data.engine} is installed; download the weights again from its card.`
                            : undefined}
                    </ErrorAlert>
                ) : undefined}

                {feed.lines.length > 0 ? (
                    <ScrollArea h={220} viewportRef={viewport} type="auto">
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
