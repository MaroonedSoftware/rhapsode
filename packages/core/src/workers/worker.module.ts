import type { ServerKitModule } from '@maroonedsoftware/fastify';
import { Logger } from '@maroonedsoftware/logger';

import { DEFAULTS, type RhapsodeConfig } from '../config.js';
import { EngineRegistry } from '../registry/engine.registry.js';
import type { SupervisorOptions } from './worker.handle.js';
import { WorkerRegistry } from './worker.registry.js';

export const workerModule = (settings: RhapsodeConfig): ServerKitModule => {
    const options: SupervisorOptions = {
        socketDir: settings.workers?.socketDir,
        startupTimeoutSeconds: settings.workers?.startupTimeoutSeconds ?? DEFAULTS.startupTimeoutSeconds,
        drainGraceMs: settings.workers?.drainGraceMs ?? DEFAULTS.drainGraceMs,
        maxRestarts: settings.workers?.maxRestarts ?? DEFAULTS.maxRestarts,
        restartDecaySeconds: settings.workers?.restartDecaySeconds ?? DEFAULTS.restartDecaySeconds,
    };

    return {
        name: 'workers',

        async setup(registry) {
            registry
                .register(WorkerRegistry)
                .useFactory(container => new WorkerRegistry(container.get(EngineRegistry), container.get(Logger), options))
                .asSingleton();
        },

        /**
         * Spawning happens in `ready` rather than `start`, because `ready` is not awaited: a cold
         * engine taking twenty seconds must not delay the socket binding. A spawn that loses the
         * race to shutdown checks the signal and stops itself, or the core exits leaving an orphan.
         */
        async ready(container, signal) {
            const engines = container.get(EngineRegistry);
            const workers = container.get(WorkerRegistry);
            const logger = container.get(Logger);

            await Promise.allSettled(
                engines
                    .ids()
                    .filter(id => engines.entry(id)?.autostart === true)
                    .map(async id => {
                        try {
                            await workers.client(id);
                            if (signal.aborted) await workers.handle(id).stop('shutdown');
                        } catch (error) {
                            logger.warn('autostart failed', { engine: id, error });
                        }
                    }),
            );
        },

        async shutdown(container) {
            await container.get(WorkerRegistry).stopAll();
        },
    };
};
