import { useQuery } from '@tanstack/react-query';

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
