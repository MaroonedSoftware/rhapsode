import type { ServerKitModule } from '@maroonedsoftware/fastify';
import { Logger } from '@maroonedsoftware/logger';

import { DEFAULTS, type RhapsodeConfig } from '../config.js';
import { EngineRegistry } from '../registry/engine.registry.js';
import { WorkerRegistry } from '../workers/worker.registry.js';
import { ResidencyManager, type ResidencyPolicy } from './residency.manager.js';

export const residencyModule = (settings: RhapsodeConfig): ServerKitModule => {
    const policy: ResidencyPolicy = {
        maxResidentModels: settings.residency?.maxResidentModels ?? DEFAULTS.maxResidentModels,
        evictionWaitSeconds: settings.residency?.evictionWaitSeconds ?? DEFAULTS.evictionWaitSeconds,
        idleUnloadSeconds: settings.residency?.idleUnloadSeconds,
        idleTerminateSeconds: settings.residency?.idleTerminateSeconds,
    };

    return {
        name: 'residency',

        async setup(registry) {
            registry
                .register(ResidencyManager)
                .useFactory(
                    container => new ResidencyManager(container.get(WorkerRegistry), container.get(EngineRegistry), container.get(Logger), policy),
                )
                .asSingleton();
        },
    };
};
