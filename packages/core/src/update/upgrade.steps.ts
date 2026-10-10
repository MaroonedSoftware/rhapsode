import type { UpgradeSteps } from '@rhapsode/contract';

import { parseVersion } from './version.compare.js';

/**
 * What upgrading this box to `latest` takes, from the image compose named. protocol.md § 9.
 *
 * The tag is the whole question. On 2026-10-10 a box pinned to `0.1.22`, with a compose.yaml naming
 * the registry releases had left, ran `docker compose pull && docker compose up -d` and stayed on
 * 0.1.22, while the banner said only to change the pin "if your compose pins it". The core knows the
 * tag, so it says exactly what the pin has to become. Undefined for a tag no published image carries
 * (`local`, from compose.build.yaml), since nothing here knows how that box is rebuilt.
 */
export function upgradeSteps(image: string, latest: string, options: { reinstallOutdated: boolean; webPort: number }): UpgradeSteps | undefined {
    const tag = tagOf(image);
    const next = parseVersion(latest);
    if (next === undefined) return undefined;
    const line = `${next.major}.${next.minor}`;

    let version: string | undefined;
    if (tag === 'latest' || tag === line) version = undefined;
    else if (/^\d+\.\d+$/.test(tag)) version = line;
    else if (parseVersion(tag) !== undefined) version = latest;
    else return undefined;

    return {
        image,
        ...(version === undefined ? {} : { version }),
        commands: [
            'docker compose pull',
            // --wait, so a reinstall below reaches the new core rather than the old one going down.
            'docker compose up -d --wait',
            ...(options.reinstallOutdated ? [] : [`curl -fsS -X POST http://127.0.0.1:${options.webPort}/api/installs/outdated`]),
        ],
    };
}

/** The tag of an image reference, `latest` where it names none, as Docker reads it. */
function tagOf(image: string): string {
    const name = image.split('@')[0]!;
    const colon = name.lastIndexOf(':');
    // A colon before the last slash is a registry's port, not a tag.
    return colon > name.lastIndexOf('/') ? name.slice(colon + 1) : 'latest';
}
