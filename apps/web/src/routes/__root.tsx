import { Anchor, AppShell, Box, Button, Group, Text } from '@mantine/core';
import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Link, Outlet, useRouterState } from '@tanstack/react-router';

import { RhapsodeMark } from '../components/shell/rhapsode.mark';
import { CoreVersion, UpdateBanner } from '../components/update/update.banner';

/** Everything the router needs from outside. Supplied once in `main.tsx`. */
export interface RouterContext {
    queryClient: QueryClient;
}

export function RootLayout() {
    const pathname = useRouterState({ select: state => state.location.pathname });
    return (
        <AppShell header={{ height: 56 }} padding="lg">
            <Anchor href="#main" className="rh-skip">
                Skip to content
            </Anchor>
            <AppShell.Header style={{ background: 'var(--rh-surface)', borderColor: 'var(--rh-border)' }}>
                <Group h="100%" px="md" gap="lg" wrap="nowrap">
                    <Group gap="xs" wrap="nowrap">
                        <RhapsodeMark />
                        <Text fw={650} size="lg">
                            Rhapsode
                        </Text>
                    </Group>
                    <Group gap={4} wrap="nowrap" component="nav" aria-label="Pages">
                        <Button
                            variant={pathname === '/' ? 'light' : 'subtle'}
                            size="compact-sm"
                            renderRoot={(props: object) => <Link to="/" {...props} />}
                        >
                            Engines
                        </Button>
                        <Button
                            variant={pathname === '/try' ? 'light' : 'subtle'}
                            size="compact-sm"
                            renderRoot={(props: object) => <Link to="/try" {...props} />}
                        >
                            Try it
                        </Button>
                        <Button
                            variant={pathname === '/reference' ? 'light' : 'subtle'}
                            size="compact-sm"
                            renderRoot={(props: object) => <Link to="/reference" {...props} />}
                        >
                            API
                        </Button>
                    </Group>
                    <CoreVersion />
                </Group>
            </AppShell.Header>
            <AppShell.Main id="main" tabIndex={-1}>
                <Box maw={1100}>
                    <UpdateBanner />
                    <Outlet />
                </Box>
            </AppShell.Main>
        </AppShell>
    );
}

export const Route = createRootRouteWithContext<RouterContext>()({ component: RootLayout });
