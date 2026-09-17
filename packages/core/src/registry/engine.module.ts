import type { ServerKitModule } from '@maroonedsoftware/fastify';

import { CATALOG } from './engines.catalog.js';
import { EngineRegistry } from './engine.registry.js';
import type { RhapsodeConfig } from '../config.js';
import { DEFAULTS } from '../config.js';

/**
 * Declare every engine this box has, by joining the shipped catalog to local configuration.
 *
 * It happens in `setup` rather than `start` because it is pure reading: no process, no socket, no
 * filesystem. That also means a configuration mistake, such as an engine nobody can see the weights
 * licence for, fails while the server is still being built rather than after it is listening.
 *
 * Nothing here spawns anything. A registry that started a process in order to answer `GET /engines`
 * would make listing what is installed cost a cold start each time.
 */
export const engineModule = (settings: RhapsodeConfig): ServerKitModule => {
    // Built here rather than inside the factory, so a configuration mistake is thrown while the
    // server is being assembled rather than lazily on the first request that happens to need it.
    const engines = buildRegistry(settings);

    return {
        name: 'engines',

        async setup(registry) {
            registry
                .register(EngineRegistry)
                .useFactory(() => engines)
                .asSingleton();
        },
    };
};

export function buildRegistry(settings: RhapsodeConfig): EngineRegistry {
    const engines = new EngineRegistry();
    engines.maxResidentModels = settings.residency?.maxResidentModels ?? DEFAULTS.maxResidentModels;

    for (const [id, configured] of Object.entries(settings.engines ?? {})) {
        if (configured.enabled === false) continue;

        const catalogued = CATALOG[id];
        const license = configured.license ?? catalogued?.license;
        if (license === undefined) {
            throw new Error(
                `engine "${id}" is configured but is not in the catalog, so nothing knows its licence. ` +
                    'Declare `license` on the config entry, with the weights licence named separately.',
            );
        }

        engines.declare({
            id,
            displayName: configured.displayName ?? catalogued?.displayName ?? id,
            license,
            module: configured.module ?? catalogued?.module,
            defaultVariant: configured.defaultVariant ?? catalogued?.defaultVariant,
            venv: configured.venv,
            command: configured.command,
            args: configured.args,
            cwd: configured.cwd,
            env: configured.env,
            url: configured.url,
            autostart: configured.autostart ?? false,
        });
    }

    return engines;
}
