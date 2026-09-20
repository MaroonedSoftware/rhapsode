import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { SDK_PACKAGE } from '../install/install.plan.js';

/** `rhapsode-worker` as a distribution directory spells it: PEP 503 replaces every run of `-._`. */
const DISTRIBUTION = SDK_PACKAGE.replace(/[-_.]+/g, '_');

/**
 * Where a virtualenv keeps its packages. `lib/python3.12/site-packages` everywhere but Windows,
 * which drops the interpreter level, so the minor version is not something to guess at.
 */
const siteRoots = (venv: string): string[] =>
    process.platform === 'win32'
        ? [join(venv, 'Lib', 'site-packages')]
        : readdirSyncSafe(join(venv, 'lib')).map(name => join(venv, 'lib', name, 'site-packages'));

/**
 * The version of the worker SDK installed in this engine's virtualenv, or undefined.
 *
 * Read from the virtualenv rather than asked of the worker, because an engine's normal state is
 * `down`: a model loads when something speaks and leaves when nothing does (§ 3), so a version that
 * arrived in a handshake would be absent exactly when an operator asks whether their engines
 * survived an upgrade. On the box this was written for, both engines were down and both were stale.
 *
 * From the `.dist-info` directory name, which PEP 376 defines as `{name}-{version}.dist-info`, so
 * no file is opened and no interpreter is spawned. That cost is why this can run for every engine
 * at registration rather than being something an operator has to ask for: 0.063 ms per engine on
 * an Apple Silicon laptop, against 21.7 ms to start that venv's interpreter on `python -c pass`,
 * which is the cheapest an answer from the venv's own Python could possibly be.
 *
 * Undefined rather than a guess. A remote engine has no virtualenv here and an operator's own
 * `command` may point anywhere, and inventing a number for either would be worse than saying
 * nothing, in the way § 9 means: absent is "not something this core can say".
 */
export function installedWorkerVersion(venv: string | undefined): string | undefined {
    if (venv === undefined) return undefined;
    for (const root of siteRoots(venv)) {
        for (const name of readdirSyncSafe(root)) {
            const version = name.match(new RegExp(`^${DISTRIBUTION}-(.+)\\.dist-info$`, 'i'))?.[1];
            if (version !== undefined) return version;
        }
    }
    return undefined;
}

/**
 * A directory listing, or nothing.
 *
 * Every caller above is asking a question whose honest answer on failure is "no version", and a
 * virtualenv that is missing, half-built or unreadable is the ordinary case this runs into: the
 * registry calls this while declaring engines at boot, where a throw would take the server down
 * over a diagnostic.
 */
function readdirSyncSafe(path: string): string[] {
    try {
        return readdirSync(path);
    } catch {
        return [];
    }
}
