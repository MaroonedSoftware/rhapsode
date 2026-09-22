import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Settings, SettingsPatch } from '@maroonedsoftware/rhapsode-sdk';

import { sdk } from './client';
import { queryKeys } from './query.keys';
import { unwrap } from './sdk.error';

/**
 * Every setting. A management route, reading included, so a page opened from another machine is
 * refused and says so rather than showing a form it could not save. § 10.
 */
export function useSettings() {
    return useQuery({
        queryKey: queryKeys.settings(),
        queryFn: async () => unwrap<Settings>(await sdk.public.settings()),
    });
}

/**
 * Change some settings; `null` clears one. Invalidates rather than writing the answer into the cache,
 * as every mutation here does, and takes residency and the update status with it: a keep-alive
 * changed now moves the deadlines `/residency` reports, `maxResidentModels` is its `max`, and
 * `update.check` is what `/update` answers `off` for.
 */
export function useUpdateSettings() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (patch: SettingsPatch) => unwrap<Settings>(await sdk.public.updateSettings(patch)),
        onSettled: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.settings() });
            void queryClient.invalidateQueries({ queryKey: queryKeys.residency() });
            void queryClient.invalidateQueries({ queryKey: queryKeys.update() });
        },
    });
}
