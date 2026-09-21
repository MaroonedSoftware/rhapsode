import type { ReactNode } from 'react';
import { Anchor, Badge, Card, Group, Stack, Text, Title } from '@mantine/core';
import type { CatalogEntry } from '@maroonedsoftware/rhapsode-sdk';

import { severityColor } from '../shared/status';
import { LicenseLine } from './license.line';

const INSTALLED: Record<CatalogEntry['installed'], { label: string; color: string }> = {
    no: { label: 'Not installed', color: 'gray' },
    installing: { label: 'Installing', color: 'blue' },
    yes: { label: 'Installed', color: 'teal' },
};

export interface EngineCardProps {
    entry: CatalogEntry;
    /** What can be done to this engine. The catalog page supplies none; the install work adds them. */
    actions?: ReactNode;
}

/** One engine that exists, and what this box has of it. */
export function EngineCard({ entry, actions }: EngineCardProps) {
    const installed = INSTALLED[entry.installed];
    const notes = entry.license.notes;

    return (
        <Card>
            <Stack gap="sm">
                <Group justify="space-between" align="flex-start" wrap="nowrap">
                    <Stack gap={2}>
                        <Title order={2} size="h4">
                            {entry.displayName}
                        </Title>
                        <Text size="xs" c="dimmed" ff="monospace">
                            {entry.package}
                        </Text>
                    </Stack>
                    <Group gap="xs" wrap="nowrap">
                        {/* An engine the operator configured by hand is theirs: installed, and not the page's to remove. */}
                        {entry.installed === 'yes' && !entry.managed ? (
                            <Badge variant="light" color="gray">
                                Configured by hand
                            </Badge>
                        ) : undefined}
                        {entry.outdated === true ? (
                            <Badge variant="light" color={severityColor.warning}>
                                Behind this server
                            </Badge>
                        ) : undefined}
                        <Badge variant="light" color={installed.color}>
                            {installed.label}
                        </Badge>
                    </Group>
                </Group>
                <LicenseLine license={entry.license} />
                {notes === undefined ? undefined : notes.startsWith('https://') ? (
                    <Anchor href={notes} target="_blank" rel="noreferrer" size="sm">
                        {notes}
                    </Anchor>
                ) : (
                    <Text size="sm" c="dimmed">
                        {notes}
                    </Text>
                )}
                {entry.outdated === true ? (
                    <Text size="sm" c="dimmed">
                        Its worker is from rhapsode {entry.workerVersion}, not this server&rsquo;s version, so it works but never sends anything added
                        since.{' '}
                        {entry.managed
                            ? 'Reinstalling it brings it up to date.'
                            : 'It is configured by hand, so rebuilding it is the operator’s to do.'}
                    </Text>
                ) : undefined}
                {actions ? <Group gap="xs">{actions}</Group> : undefined}
            </Stack>
        </Card>
    );
}
