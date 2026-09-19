import { queryOptions, useQuery } from '@tanstack/react-query';

import { sdk } from './client';
import { queryKeys } from './query.keys';

/**
 * The core's own description of its API, `GET /openapi.json` (§ 9). Never stale while the page is
 * open: it changes only when the core is replaced, and a replaced core reloads nobody's page anyway.
 */
export const referenceOptions = queryOptions({
    queryKey: queryKeys.reference(),
    queryFn: () => sdk.public.openapi(),
    staleTime: Infinity,
});

export function useReference() {
    return useQuery(referenceOptions);
}
