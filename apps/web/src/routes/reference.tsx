import { createFileRoute } from '@tanstack/react-router';

import { referenceOptions } from '../api/reference.queries';
import { ReferencePage } from '../components/reference/reference.page';

// `/reference` and never `/api`, which is the proxy's prefix: a page there would be sent to the core.
export const Route = createFileRoute('/reference')({
    // Through the cache, so the loader and the page's own query are one request.
    loader: ({ context }) => context.queryClient.ensureQueryData(referenceOptions),
    component: ReferencePage,
});
