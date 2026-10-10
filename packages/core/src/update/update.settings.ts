import type { RhapsodeConfig } from '../config.js';

export interface UpdateSettings {
    /** Whether the core asks GitHub for the latest release. On unless turned off. § 9. */
    check: boolean;
    /** Which upgrade instructions apply. The image says `docker` in its own environment. */
    distribution: 'docker' | 'source';
    /** Whether a start reinstalls every engine behind this core. Off unless turned on. § 10. */
    reinstallOutdated: boolean;
    /**
     * The image compose named, tag and all, from `RHAPSODE_IMAGE`, which compose.yaml sets from its
     * own `image:`. Absent outside the image and under a compose.yaml older than the variable.
     */
    image?: string;
    /** The host port compose published the page on, which the reinstall's `curl` goes through. */
    webPort: number;
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
        reinstallOutdated: settings.update?.reinstallOutdated ?? false,
        ...(env.RHAPSODE_IMAGE?.trim() ? { image: env.RHAPSODE_IMAGE.trim() } : {}),
        webPort: Number(env.RHAPSODE_WEB_PORT) || 8081,
    };
}
