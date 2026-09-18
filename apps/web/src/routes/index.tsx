import { createFileRoute } from '@tanstack/react-router';

import { catalogOptions } from '../api/catalog.queries';
import { CatalogPage } from '../components/catalog/catalog.page';

export const Route = createFileRoute('/')({
    // Through the cache, so the loader and the page's own query are one request.
    loader: ({ context }) => context.queryClient.ensureQueryData(catalogOptions),
    component: CatalogPage,
});
