import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { QueryClientProvider } from '@tanstack/react-query';
import { createRouter, RouterProvider } from '@tanstack/react-router';

// Self-hosted rather than fetched: a page for a self-hosted server should not need a font CDN.
import '@fontsource-variable/inter';

// Core first: notifications builds on it and expects its styles laid down before its own.
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
// LAST, after every Mantine stylesheet, so the page's own surfaces win.
import './tokens.css';

import { createQueryClient } from './api/query.client';
import { PageSkeleton } from './components/shared/page.skeleton';
import { RouteError } from './components/shared/route.error';
import { routeTree } from './routeTree.gen';
import { cssVariablesResolver, theme } from './theme';

const queryClient = createQueryClient();

const router = createRouter({
    routeTree,
    context: { queryClient },
    defaultErrorComponent: RouteError,
    defaultPendingComponent: () => <PageSkeleton variant="card" />,
});

declare module '@tanstack/react-router' {
    interface Register {
        router: typeof router;
    }
}

const rootElement = document.getElementById('root');
if (!rootElement) {
    throw new Error('Missing #root element in index.html');
}

createRoot(rootElement).render(
    <StrictMode>
        <QueryClientProvider client={queryClient}>
            {/* `auto` follows the operating system. */}
            <MantineProvider theme={theme} cssVariablesResolver={cssVariablesResolver} defaultColorScheme="auto">
                <Notifications position="top-right" limit={3} />
                <RouterProvider router={router} />
            </MantineProvider>
        </QueryClientProvider>
    </StrictMode>,
);
