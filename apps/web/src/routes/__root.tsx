import { useEffect } from 'react';
import { Anchor, AppShell, Box, Button, Group, Text } from '@mantine/core';
import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Link, Outlet, useRouterState } from '@tanstack/react-router';

import { RhapsodeMark } from '../components/shell/rhapsode.mark';
import { CoreVersion, UpdateBanner } from '../components/update/update.banner';

/** Everything the router needs from outside. Supplied once in `main.tsx`. */
export interface RouterContext {
    queryClient: QueryClient;
}

/**
 * The four pages, once: the nav draws its buttons from this and the tab takes its title from it, so
 * a page cannot be added to one and not the other. Four tabs all reading "Rhapsode" could not be
 * told apart, and a screen reader announced every navigation as the same page.
 */
const PAGES = [
    { to: '/', label: 'Engines' },
    { to: '/try', label: 'Try it' },
    { to: '/reference', label: 'API' },
    { to: '/settings', label: 'Settings' },
] as const;

export function RootLayout() {
    const pathname = useRouterState({ select: state => state.location.pathname });
    const here = PAGES.find(page => page.to === pathname);

    useEffect(() => {
        document.title = here === undefined ? 'Rhapsode' : `${here.label} · Rhapsode`;
    }, [here]);

    return (
        <AppShell header={{ height: 56 }} padding="lg">
            <Anchor href="#main" className="rh-skip">
                Skip to content
            </Anchor>
            <AppShell.Header style={{ background: 'var(--rh-surface)', borderColor: 'var(--rh-border)' }}>
                <Group h="100%" px="md" gap="lg" wrap="nowrap">
                    <Group gap="xs" wrap="nowrap">
                        <RhapsodeMark />
                        {/* The mark alone on a phone: with four pages the name pushed the last off the edge. */}
                        <Text fw={650} size="lg" visibleFrom="sm">
                            Rhapsode
                        </Text>
                    </Group>
                    <Group gap={4} wrap="nowrap" component="nav" aria-label="Pages">
                        {PAGES.map(page => (
                            <Button
                                key={page.to}
                                variant={page === here ? 'light' : 'subtle'}
                                size="compact-sm"
                                aria-current={page === here ? 'page' : undefined}
                                renderRoot={(props: object) => <Link to={page.to} {...props} />}
                            >
                                {page.label}
                            </Button>
                        ))}
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
