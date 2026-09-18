import { queryOptions, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { InstallJob } from '@rhapsode/sdk';

import { sdk } from './client';
import { queryKeys } from './query.keys';
import { unwrap } from './sdk.error';

export const installJobsOptions = queryOptions({
    queryKey: queryKeys.installs.list(),
    queryFn: async () => unwrap<InstallJob[]>(await sdk.public.installJobs()),
});

export function useInstallJobs() {
    return useQuery(installJobsOptions);
}

export function useInstallJob(id: string | undefined) {
    return useQuery({
        queryKey: queryKeys.installs.detail(id ?? ''),
        queryFn: async () => unwrap<InstallJob>(await sdk.public.installJob(id!)),
        enabled: id !== undefined,
    });
}

/**
 * What changes when a job starts or ends: the catalog's `installed`, and the job list.
 *
 * Invalidated rather than patched. The core is the one writer of both, and a guess at what it now
 * says is the answer the page would have to take back when the refetch lands.
 */
export function invalidateAfterJob(queryClient: QueryClient): Promise<void> {
    return Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.catalog() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.installs.all() }),
    ]).then(() => undefined);
}

export function useInstallEngine() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (engine: string) => unwrap<InstallJob>(await sdk.public.installEngine(engine)),
        onSettled: () => invalidateAfterJob(queryClient),
    });
}

export function usePullEngine() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async ({ engine, variant }: { engine: string; variant?: string }) =>
            unwrap<InstallJob>(await sdk.public.pullEngine(engine, variant === undefined ? {} : { variant })),
        onSettled: () => invalidateAfterJob(queryClient),
    });
}

export function useUninstallEngine() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (engine: string) => {
            unwrap(await sdk.public.uninstallEngine(engine));
        },
        onSettled: () => invalidateAfterJob(queryClient),
    });
}
