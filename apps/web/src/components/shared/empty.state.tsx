import type { ReactNode } from 'react';
import { Card, Stack, Text } from '@mantine/core';

export interface EmptyStateProps {
    /** What is not here, stated plainly. */
    title?: string;
    /** Why it is not here, and what would change that. */
    children: ReactNode;
    /** A way out, when there is one. */
    action?: ReactNode;
}

/** A place with nothing in it yet, which is not the same as a place that is broken. */
export function EmptyState({ title, children, action }: EmptyStateProps) {
    return (
        <Card padding="xl">
            <Stack gap="xs" align="flex-start">
                {title ? <Text fw={600}>{title}</Text> : undefined}
                <Text size="sm" c="dimmed" maw={520}>
                    {children}
                </Text>
                {action}
            </Stack>
        </Card>
    );
}
