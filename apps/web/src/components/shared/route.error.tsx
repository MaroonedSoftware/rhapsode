import { Button, Card, Group, Stack, Text, Title } from '@mantine/core';
import { IconRefresh } from '@tabler/icons-react';
import { useRouter, type ErrorComponentProps } from '@tanstack/react-router';

import { apiErrorMessage, isUnreachable } from '../../api/sdk.error';

/** The router's default error boundary. It replaces the page and leaves the header in place. */
export function RouteError({ error, reset }: ErrorComponentProps) {
    const router = useRouter();
    // Both, in this order: `reset` clears the boundary and `invalidate` re-runs what threw.
    const retry = () => {
        reset();
        void router.invalidate();
    };

    return (
        <Card padding="xl" maw={560}>
            <Stack gap="md">
                <Stack gap="xxs">
                    <Title order={2} size="h4">
                        This page did not load
                    </Title>
                    <Text c="dimmed" size="sm">
                        {isUnreachable(error)
                            ? 'The rhapsode server is not answering. Start it with `node apps/server/dist/main.js`.'
                            : apiErrorMessage(error, 'Something in this page failed while it was loading.')}
                    </Text>
                </Stack>
                <Group>
                    <Button leftSection={<IconRefresh size={16} />} onClick={retry}>
                        Try again
                    </Button>
                </Group>
            </Stack>
        </Card>
    );
}
