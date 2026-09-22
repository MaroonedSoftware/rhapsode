import type { ServerKitModule } from '@maroonedsoftware/fastify';
import { Logger } from '@maroonedsoftware/logger';

import { EngineRegistry } from '../registry/engine.registry.js';
import { SettingsService } from '../settings/settings.service.js';
import { WorkerRegistry } from '../workers/worker.registry.js';
import { ResidencyManager } from './residency.manager.js';

export const residencyModule = (): ServerKitModule => {
    return {
        name: 'residency',

        async setup(registry) {
            registry
                .register(ResidencyManager)
                // The policy is the settings service's object, not a copy, so a setting written
                // through PATCH /settings is the one the manager reads on its next decision. § 10.
                .useFactory(
                    container =>
                        new ResidencyManager(
                            container.get(WorkerRegistry),
                            container.get(EngineRegistry),
                            container.get(Logger),
                            container.get(SettingsService).residencyPolicy,
                        ),
                )
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
