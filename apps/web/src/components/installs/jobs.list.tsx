import { Badge, Group, Stack, Text, UnstyledButton } from '@mantine/core';
import type { InstallJob } from '@rhapsode/sdk';

import { jobTitle } from './job.panel';
import { jobBadge } from './job.state';

export interface JobsListProps {
    jobs: InstallJob[];
    selected?: string;
    onSelect: (id: string) => void;
}

/** Every job the server remembers, newest first. It forgets them on restart, and says so in the spec. */
export function JobsList({ jobs, selected, onSelect }: JobsListProps) {
    return (
        <Stack gap={4}>
            {jobs.map(job => (
                <UnstyledButton
                    key={job.id}
                    onClick={() => onSelect(job.id)}
                    aria-current={job.id === selected ? 'true' : undefined}
                    p="xs"
                    style={{
                        borderRadius: 'var(--mantine-radius-sm)',
                        background: job.id === selected ? 'var(--mantine-color-default-hover)' : undefined,
                    }}
                >
                    <Group justify="space-between" wrap="nowrap">
                        <Text size="sm">{jobTitle(job)}</Text>
                        <Badge size="sm" variant="light" color={jobBadge(job).color}>
                            {jobBadge(job).label}
                        </Badge>
                    </Group>
                </UnstyledButton>
            ))}
        </Stack>
    );
}
