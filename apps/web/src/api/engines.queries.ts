import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Capabilities, EngineSpeakRequest, Voice } from '@rhapsode/sdk';

import { sdk } from './client';
import { queryKeys } from './query.keys';
import { unwrap } from './sdk.error';

/** What this box has, as `GET /engines` says. Never spawns anything. */
export function useEngines() {
    return useQuery({ queryKey: queryKeys.engines(), queryFn: () => sdk.public.engines() });
}

/**
 * One engine's capability document. Asking starts the worker process, which is cheap, and loads no
 * model, which is not. `current` appears once a model is resident, so a speak invalidates this.
 */
export function useCapabilities(engine: string | undefined) {
    return useQuery({
        queryKey: queryKeys.engine.capabilities(engine ?? ''),
        queryFn: async () => unwrap<Capabilities>(await sdk.public.engineCapabilities(engine!)),
        enabled: engine !== undefined,
    });
}

export function useVoices(engine: string | undefined) {
    return useQuery({
        queryKey: queryKeys.engine.voices(engine ?? ''),
        queryFn: async () => unwrap<Voice[]>(await sdk.public.engineVoices(engine!)),
        enabled: engine !== undefined,
    });
}

export interface Spoken {
    url: string;
    bytes: number;
    milliseconds: number;
}

/**
 * One line, spoken, as a playable URL.
 *
 * `stream: false`, because the page plays a finished file and § 6 says a buffered request reports a
 * failure strictly better: every refusal is still an ordinary envelope rather than a cut-off body.
 * The caller revokes the URL when it replaces it.
 */
export function useSpeak() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (request: EngineSpeakRequest): Promise<Spoken> => {
            const started = performance.now();
            const audio = unwrap<Blob>(await sdk.public.speak({ ...request, format: 'wav', stream: false }));
            return { url: URL.createObjectURL(audio), bytes: audio.size, milliseconds: Math.round(performance.now() - started) };
        },
        // A speak may have loaded a model or changed the variant, which is what `current` reports.
        onSettled: (_data, _error, request) => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.engine.capabilities(request.engine) });
            void queryClient.invalidateQueries({ queryKey: queryKeys.engines() });
        },
    });
}
