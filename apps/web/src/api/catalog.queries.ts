import { queryOptions, useQuery } from '@tanstack/react-query';

import { sdk } from './client';
import { queryKeys } from './query.keys';

export const catalogOptions = queryOptions({
    queryKey: queryKeys.catalog(),
    queryFn: () => sdk.public.catalog(),
});

export function useCatalog() {
    return useQuery(catalogOptions);
}
