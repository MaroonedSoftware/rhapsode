import { createFileRoute } from '@tanstack/react-router';

import { TryPage } from '../components/try/try.page';

export const Route = createFileRoute('/try')({
    validateSearch: (search: Record<string, unknown>): { engine?: string } => (typeof search.engine === 'string' ? { engine: search.engine } : {}),
    component: function TryRoute() {
        const { engine } = Route.useSearch();
        return <TryPage engine={engine} />;
    },
});
