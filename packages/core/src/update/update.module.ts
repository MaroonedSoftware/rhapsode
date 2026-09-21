import type { ServerKitModule } from '@maroonedsoftware/fastify';
import { Logger } from '@maroonedsoftware/logger';

import type { RhapsodeConfig } from '../config.js';
import { UpdateChecker } from './update.checker.js';
import { resolveUpdateSettings } from './update.settings.js';

/** Nothing to shut down: the check runs only when asked, and holds no timer. § 9. */
export const updateModule = (settings: RhapsodeConfig, fetcher: typeof fetch = fetch): ServerKitModule => {
    const update = resolveUpdateSettings(settings);

    return {
        name: 'update',

        async setup(registry) {
            registry
                .register(UpdateChecker)
                .useFactory(container => new UpdateChecker(update, container.get(Logger), fetcher))
                .asSingleton();
        },
    };
};
