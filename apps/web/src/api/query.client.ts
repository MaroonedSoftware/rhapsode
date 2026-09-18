import { QueryClient } from '@tanstack/react-query';

import { isUnreachable } from './sdk.error';

/**
 * The app's single QueryClient, from a factory so tests get a clean cache per case.
 *
 * A refusal is the core's answer and asking again gets the same one, so only an unreachable core is
 * retried, and briefly: somebody starting the server after opening the page should see it arrive.
 */
export function createQueryClient(): QueryClient {
    return new QueryClient({
        defaultOptions: {
            queries: {
                staleTime: 10_000,
                retry: (failures, error) => isUnreachable(error) && failures < 3,
                refetchOnWindowFocus: true,
            },
            mutations: { retry: false },
        },
    });
}
