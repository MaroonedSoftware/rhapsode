import type { ServerKitModule } from '@maroonedsoftware/fastify';
import { Logger } from '@maroonedsoftware/logger';

import { SettingsService } from '../settings/settings.service.js';
import { UpdateChecker } from './update.checker.js';

/** Nothing to shut down: the check runs only when asked, and holds no timer. § 9. */
export const updateModule = (fetcher: typeof fetch = fetch): ServerKitModule => {
    return {
        name: 'update',

        async setup(registry) {
            registry
                .register(UpdateChecker)
                // The settings service's object rather than a copy, so turning the check off through
                // PATCH /settings stops the next one. § 10.
                .useFactory(container => new UpdateChecker(container.get(SettingsService).update, container.get(Logger), fetcher))
                .asSingleton();
        },
    };
};
