import type { RhapsodeConfig } from '../config.js';

export interface UpdateSettings {
    /** Whether the core asks GitHub for the latest release. On unless turned off. § 9. */
    check: boolean;
    /** Which upgrade instructions apply. The image says `docker` in its own environment. */
    distribution: 'docker' | 'source';
}

const OFF = new Set(['0', 'false', 'off', 'no']);

/**
 * `update.check` from the config, which `RHAPSODE_UPDATE_CHECK` can turn off but not on.
 *
 * The variable exists for a box whose config is not the operator's to edit (a compose file is), and
 * only turns the check off, because a variable that could override a config's `false` would let
 * whoever sets the environment decide the box phones out after the operator decided it would not.
 */
export function resolveUpdateSettings(settings: RhapsodeConfig, env: NodeJS.ProcessEnv = process.env): UpdateSettings {
    const variable = env.RHAPSODE_UPDATE_CHECK?.trim().toLowerCase();
    return {
        check: variable !== undefined && OFF.has(variable) ? false : (settings.update?.check ?? true),
        // Set by the image rather than passed through compose, because compose.yaml is downloaded once
        // and never refreshed, and the image is what an upgrade replaces.
        distribution: env.RHAPSODE_DISTRIBUTION === 'docker' ? 'docker' : 'source',
    };
}
