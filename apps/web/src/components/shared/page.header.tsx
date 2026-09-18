import type { ReactNode } from 'react';
import { Group, Stack, Text, Title } from '@mantine/core';

export interface PageHeaderProps {
    title: ReactNode;
    /** One line under the title. Orientation, not documentation. */
    description?: ReactNode;
    /** Buttons for this page, held on the title's own line. */
    actions?: ReactNode;
}

/**
 * The top of a page: what this is, and what can be done to it. The actions are always on the
 * title's line and always to the right, so the label and its control stay together.
 */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
    return (
        <Stack gap="xxs">
            <Group justify="space-between" align="flex-start" gap="md" wrap="wrap">
                <Title order={1} size="h2">
                    {title}
                </Title>
                {actions ? (
                    <Group gap="xs" style={{ flexShrink: 0 }}>
                        {actions}
                    </Group>
                ) : undefined}
            </Group>
            {typeof description === 'string' ? (
                <Text c="dimmed" size="sm" maw={720}>
                    {description}
                </Text>
            ) : (
                description
            )}
        </Stack>
    );
}
