import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EngineSummary } from '@maroonedsoftware/rhapsode-sdk';

import { sdk } from './client';
import { queryKeys } from './query.keys';
import { unwrap } from './sdk.error';

/** Often enough that a countdown does not visibly stall, rarely enough to be nothing on a server. */
const POLL_MS = 5_000;

/**
 * What is on the card. `GET /residency` reads the core's own state and starts no worker. § 3.
 *
 * Polled, and this is the one query in the page that is: every other document changes only when
 * something here asks it to, and this one changes on its own when a keep-alive runs out. Without
 * the poll a row sits on screen minutes after its model has gone.
 */
export function useResidency() {
    return useQuery({
        // No `unwrap`: this operation declares no refusal, so the SDK hands back the document
        // itself rather than a result to branch on, exactly as `useEngines` does.
        queryKey: queryKeys.residency(),
        queryFn: () => sdk.public.residency(),
        refetchInterval: POLL_MS,
    });
}

export interface UnloadAsk {
    engine: string;
    /** `terminate` gets the whole card back; `unload` keeps the process and roughly 30% with it. */
    mode?: 'terminate' | 'unload';
}

/**
 * Free a model now. A management route, so a page opened from another machine is refused. § 3, § 10.
 *
 * It invalidates the engine list and the engine's capability document as well as this one, because
 * `current` and the engine's `model` both describe weights that have just gone.
 */
export function useUnloadEngine() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async ({ engine, mode }: UnloadAsk) =>
            unwrap<EngineSummary>(await sdk.public.unloadEngine(engine, mode === undefined ? undefined : { mode })),
        onSettled: (_data, _error, { engine }) => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.residency() });
            void queryClient.invalidateQueries({ queryKey: queryKeys.engines() });
            void queryClient.invalidateQueries({ queryKey: queryKeys.engine.capabilities(engine) });
        },
    });
}
