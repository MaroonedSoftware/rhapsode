import type { Logger } from '@maroonedsoftware/logger';

import { DEFAULTS, type RhapsodeConfig } from '../config.js';
import type { ResidencyPolicy } from './residency.manager.js';

/**
 * One keep-alive, from whichever of the three spellings an operator has.
 *
 * `idleUnloadSeconds` and `idleTerminateSeconds` were separate deadlines for the two verbs, and an
 * expiry now always terminates, so both mean the same thing: how long to wait. Neither is an error,
 * because a configuration file that stops a server from starting over a renamed key is worse than
 * one that carries on and says so. A `null` counts as absent, which is what the documented sample
 * had in it.
 */
export const keepAliveFrom = (settings: RhapsodeConfig, logger?: Logger): number => {
    const residency = settings.residency ?? {};
    if (typeof residency.keepAliveSeconds === 'number') return residency.keepAliveSeconds;

    const deprecated =
        typeof residency.idleTerminateSeconds === 'number'
            ? { key: 'idleTerminateSeconds', seconds: residency.idleTerminateSeconds }
            : typeof residency.idleUnloadSeconds === 'number'
              ? { key: 'idleUnloadSeconds', seconds: residency.idleUnloadSeconds }
              : undefined;

    if (deprecated === undefined) return DEFAULTS.keepAliveSeconds;

    logger?.warn('this setting is now residency.keepAliveSeconds, and an expiry terminates rather than unloads', {
        setting: deprecated.key,
        keepAliveSeconds: deprecated.seconds,
    });
    return deprecated.seconds;
};

/** The policy from settings, with the defaults filled in. `/settings` reports and changes it. § 10. */
export const residencyPolicyFrom = (settings: RhapsodeConfig, logger?: Logger): ResidencyPolicy => ({
    maxResidentModels: settings.residency?.maxResidentModels ?? DEFAULTS.maxResidentModels,
    evictionWaitSeconds: settings.residency?.evictionWaitSeconds ?? DEFAULTS.evictionWaitSeconds,
    keepAliveSeconds: keepAliveFrom(settings, logger),
});
