/** A release version as a tag or a `package.json` carries it: `x.y.z`, a prerelease, a build. */
interface ReleaseVersion {
    major: number;
    minor: number;
    patch: number;
    prerelease?: string;
}

const RELEASE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseVersion(text: string): ReleaseVersion | undefined {
    const match = RELEASE.exec(text.trim());
    if (match === null) return undefined;
    return {
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3]),
        ...(match[4] === undefined ? {} : { prerelease: match[4] }),
    };
}

/**
 * Whether `latest` is a release this core should be told about. protocol.md § 9.
 *
 * Only a plain `x.y.z` is offered, so a prerelease tag that reached "latest" by mistake is not. A
 * core ahead of it, which is every checkout and every image built locally, is not offered a
 * downgrade, and a core at a prerelease of the same numbers is behind the release. Anything that
 * does not parse offers nothing: a banner that cries wolf over a tag somebody mistyped teaches the
 * operator to ignore the banner.
 *
 * Hand-written rather than the `semver` package because this is the whole of the ordering it needs.
 */
export function isNewer(latest: string, current: string): boolean {
    const next = parseVersion(latest);
    const now = parseVersion(current);
    if (next === undefined || now === undefined || next.prerelease !== undefined) return false;
    for (const part of ['major', 'minor', 'patch'] as const) {
        if (next[part] !== now[part]) return next[part] > now[part];
    }
    return now.prerelease !== undefined;
}
