import { Anchor, AppShell, Box, Group, Text } from '@mantine/core';
import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';

import { RhapsodeMark } from '../components/shell/rhapsode.mark';

/** Everything the router needs from outside. Supplied once in `main.tsx`. */
export interface RouterContext {
    queryClient: QueryClient;
}

export function RootLayout() {
    return (
        <AppShell header={{ height: 56 }} padding="lg">
            <Anchor href="#main" className="rh-skip">
                Skip to content
            </Anchor>
            <AppShell.Header style={{ background: 'var(--rh-surface)', borderColor: 'var(--rh-border)' }}>
                <Group h="100%" px="md" gap="xs" wrap="nowrap">
                    <RhapsodeMark />
                    <Text fw={650} size="lg">
                        Rhapsode
                    </Text>
                </Group>
            </AppShell.Header>
            <AppShell.Main id="main" tabIndex={-1}>
                <Box maw={1100}>
                    <Outlet />
                </Box>
            </AppShell.Main>
        </AppShell>
    );
}

export const Route = createRootRouteWithContext<RouterContext>()({ component: RootLayout });
