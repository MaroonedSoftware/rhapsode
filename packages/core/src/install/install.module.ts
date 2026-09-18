import type { ServerKitModule } from '@maroonedsoftware/fastify';
import { Logger } from '@maroonedsoftware/logger';
import { ServerFeed } from '@maroonedsoftware/serverfeed';

import type { RhapsodeConfig } from '../config.js';
import { EngineRegistry } from '../registry/engine.registry.js';
import { ManagedEngines } from '../registry/managed.engines.js';
import { ResidencyManager } from '../residency/residency.manager.js';
import { WorkerRegistry } from '../workers/worker.registry.js';
import { spawnRunner, type CommandRunner } from './command.runner.js';
import { EngineInstaller } from './engine.installer.js';
import { InstallJobs } from './install.jobs.js';
import { resolveInstallSettings } from './install.settings.js';

/**
 * Replay buffer for job events. An install of Chatterbox prints a few hundred lines, and a client
 * that reconnects mid-install should get all of them back rather than a `resync`.
 */
const FEED_BUFFER = 5_000;

export const installModule = (settings: RhapsodeConfig, runner: CommandRunner = spawnRunner): ServerKitModule => {
    const install = resolveInstallSettings(settings);

    return {
        name: 'install',

        async setup(registry) {
            registry
                .register(ServerFeed)
                .useFactory(() => new ServerFeed({ bufferSize: FEED_BUFFER }))
                .asSingleton();
            registry
                .register(InstallJobs)
                .useFactory(container => new InstallJobs(container.get(ServerFeed), container.get(Logger)))
                .asSingleton();
            registry
                .register(EngineInstaller)
                .useFactory(
                    container =>
                        new EngineInstaller(
                            container.get(EngineRegistry),
                            container.get(WorkerRegistry),
                            container.get(ResidencyManager),
                            container.get(ManagedEngines),
                            container.get(InstallJobs),
                            install,
                            runner,
                        ),
                )
                .asSingleton();
        },

        /** Registered last, so this runs first: a running pip is stopped before the workers are. */
        async shutdown(container) {
            await container.get(InstallJobs).stop();
        },
    };
};
