import type { ServerKitModule } from '@maroonedsoftware/fastify';
import { Logger } from '@maroonedsoftware/logger';

import { DEFAULTS, type RhapsodeConfig } from '../config.js';
import { EngineRegistry } from '../registry/engine.registry.js';
import { WorkerRegistry } from '../workers/worker.registry.js';
import { ResidencyManager, type ResidencyPolicy } from './residency.manager.js';

/**
 * One keep-alive, from whichever of the three spellings an operator has.
 *
 * `idleUnloadSeconds` and `idleTerminateSeconds` were separate deadlines for the two verbs, and an
 * expiry now always terminates, so both mean the same thing: how long to wait. Neither is an error,
 * because a configuration file that stops a server from starting over a renamed key is worse than
 * one that carries on and says so. A `null` counts as absent, which is what the documented sample
 * had in it.
 */
export const keepAliveFrom = (settings: RhapsodeConfig, logger: Logger): number => {
    const residency = settings.residency ?? {};
    if (typeof residency.keepAliveSeconds === 'number') return residency.keepAliveSeconds;

    const deprecated =
        typeof residency.idleTerminateSeconds === 'number'
            ? { key: 'idleTerminateSeconds', seconds: residency.idleTerminateSeconds }
            : typeof residency.idleUnloadSeconds === 'number'
              ? { key: 'idleUnloadSeconds', seconds: residency.idleUnloadSeconds }
              : undefined;

    if (deprecated === undefined) return DEFAULTS.keepAliveSeconds;

    logger.warn('this setting is now residency.keepAliveSeconds, and an expiry terminates rather than unloads', {
        setting: deprecated.key,
        keepAliveSeconds: deprecated.seconds,
    });
    return deprecated.seconds;
};

export const residencyModule = (settings: RhapsodeConfig): ServerKitModule => {
    return {
        name: 'residency',

        async setup(registry) {
            registry
                .register(ResidencyManager)
                .useFactory(container => {
                    const logger = container.get(Logger);
                    const policy: ResidencyPolicy = {
                        maxResidentModels: settings.residency?.maxResidentModels ?? DEFAULTS.maxResidentModels,
                        evictionWaitSeconds: settings.residency?.evictionWaitSeconds ?? DEFAULTS.evictionWaitSeconds,
                        keepAliveSeconds: keepAliveFrom(settings, logger),
                    };
                    return new ResidencyManager(container.get(WorkerRegistry), container.get(EngineRegistry), logger, policy);
                })
                .asSingleton();
        },

        /**
         * Before the workers go, because this module is registered after theirs and ServerKit
         * unwinds in reverse. An expiry that fired during shutdown would build a handle for an
         * engine already stopped, and the grace period would be spent waiting on it.
         */
        async shutdown(container) {
            container.get(ResidencyManager).stopExpiry();
        },
    };
};
