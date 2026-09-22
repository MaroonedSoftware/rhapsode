import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { sdk } from './client';
import { queryKeys } from './query.keys';

/** How soon to ask again while the core's first check is out. It usually answers within a second. */
const PENDING_POLL_MS = 3_000;

/**
 * Whether a newer release exists, and this core's version. `GET /update` never waits on GitHub, so
 * the first read after boot says `pending`. § 9.
 *
 * It refetches only while it is `pending`, and stops once the core has an answer, so it is not a
 * second polled query in the sense `useResidency` is: nothing here changes on its own after that
 * except a release, and a day-old answer is what the core serves anyway.
 */
export function useUpdateStatus() {
    return useQuery({
        // No `unwrap`: this operation declares no refusal, so the SDK hands back the document itself.
        queryKey: queryKeys.update(),
        queryFn: () => sdk.public.updateStatus(),
        refetchInterval: query => (query.state.data?.check === 'pending' ? PENDING_POLL_MS : false),
    });
}

/**
 * Ask the core to check GitHub now, and put its answer where `useUpdateStatus` reads it. § 9.
 *
 * Written into the cache rather than invalidated, which is otherwise the rule here: the rule is
 * against guessing what the core now says, and this is the core's own answer, returned by the
 * request that made it. A refetch would only ask for the same document again.
 */
export function useCheckForUpdate() {
    const queryClient = useQueryClient();
    return useMutation({
        // No `unwrap`, as for the read: the operation declares no refusal. GitHub unreachable is an
        // answer, `check: failed`, not an error.
        mutationFn: () => sdk.public.checkForUpdate(),
        onSuccess: status => queryClient.setQueryData(queryKeys.update(), status),
    });
}
