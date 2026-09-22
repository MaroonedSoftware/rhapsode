import type { ServerKitModule } from '@maroonedsoftware/fastify';
import { Logger } from '@maroonedsoftware/logger';

import type { RhapsodeConfig } from '../config.js';
import { EngineRegistry } from '../registry/engine.registry.js';
import { ResidencyManager } from '../residency/residency.manager.js';
import type { StateStore } from '../state/state.store.js';
import { SettingsService } from './settings.service.js';

/**
 * The settings service, which the residency and update modules take their live policies from.
 * protocol.md § 10, "Settings".
 *
 * `operator` is the operator's file on its own. A server built straight from a settings object, as a
 * test or an embedding does, has no file apart from that object, so the object is the file.
 */
export const settingsModule = (settings: RhapsodeConfig, store: StateStore | undefined, operator: RhapsodeConfig = settings): ServerKitModule => ({
    name: 'settings',

    async setup(registry) {
        registry
            .register(SettingsService)
            .useFactory(
                container =>
                    new SettingsService(
                        store,
                        operator,
                        settings,
                        container.get(EngineRegistry),
                        () => container.get(ResidencyManager),
                        container.get(Logger),
                    ),
            )
            .asSingleton();
    },
});
