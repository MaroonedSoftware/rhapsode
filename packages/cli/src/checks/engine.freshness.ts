import type { Check, CheckResult } from '@maroonedsoftware/johnny5';

import { loadCore } from '../lib/core.js';
import { configPath } from '../lib/paths.js';
import { localEngines, readConfig } from '../lib/rhapsode.config.js';

/** One engine and the `rhapsode-worker` its virtualenv holds, or undefined where nothing could read one. */
export interface EngineWorker {
    id: string;
    workerVersion?: string;
}

/**
 * The verdict, given what each engine's virtualenv holds and what this core is.
 *
 * Pure, so the interesting half is testable without a virtualenv on disk or a CLI context. The
 * check below is the part that goes and looks.
 */
export function freshness(engines: readonly EngineWorker[], coreVersion: string): CheckResult {
    const behind = engines.filter(e => e.workerVersion !== undefined && e.workerVersion !== coreVersion);
    const unreadable = engines.filter(e => e.workerVersion === undefined);

    // A venv with no rhapsode-worker in it is the engine-venvs check's business, not this one: it
    // runs first and says so in the language of a broken venv, and two red lines for one cause is
    // one too many. Named here without further comment so the count still adds up.
    const aside = unreadable.length === 0 ? '' : `; ${unreadable.map(e => e.id).join(', ')} not readable`;

    if (behind.length === 0) return { ok: true, message: `all on ${coreVersion}${aside}` };

    const named = behind.map(e => `${e.id} ${e.workerVersion}`).join(', ');
    return {
        ok: true,
        message: `${named} against this core's ${coreVersion}. Reinstall each one (uninstall first) or it stays on the older protocol${aside}`,
    };
}

/**
 * Every local engine's `rhapsode-worker` is the one this core was released with.
 *
 * protocol.md § 9 pins an engine to the core's version when it is installed, and nothing re-pins:
 * the virtualenvs are gigabytes and outlive the core that made them on purpose. So upgrading leaves
 * every engine behind, and negotiation will not say so, because it refuses a worker whose contract
 * is too new and a stale one's contract is one this core still speaks. What is lost is every field
 * added inside the contract major since, which the old worker simply never sends. A box upgraded
 * from 0.1.3 to 0.1.6 kept speaking through a 0.1.2 worker and only stopped reporting `modelBytes`,
 * which reads as a card that cannot be measured rather than as an engine to reinstall.
 *
 * Informational, never a failure, for the reason § 9 gives: a stale worker is contract-legal, it
 * works, and an operator is free to run an engine at a version of their choosing. Red here would
 * mean "this checkout is broken", and it is not. Same shape as the ffmpeg check, which reports a
 * real limitation without calling it a fault.
 *
 * Local by design. The doctor is for this checkout, so it reads the venvs this config names rather
 * than asking a server that may not be running. Anyone against a container reads `workerVersion` on
 * `GET /engines` instead, which the core fills from the same helper.
 */
export const engineFreshness: Check = {
    name: 'engine freshness',
    run: async ctx => {
        const read = readConfig(configPath(ctx.paths.repoRoot, ctx.env));
        if (read.status !== 'ok') return { ok: true, message: 'skipped: no readable config' };
        const engines = localEngines(read.config, ctx.paths.repoRoot);
        if (engines.length === 0) return { ok: true, message: 'no local engines configured' };

        const core = await loadCore();
        if (!core) return { ok: true, message: 'skipped: the core is not built, so there is no version to compare against' };

        const installed = engines.map(engine => ({ id: engine.id, workerVersion: core.installedWorkerVersion(engine.venv) }));
        return freshness(installed, core.CORE_VERSION);
    },
};
