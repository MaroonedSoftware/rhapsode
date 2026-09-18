import type { InstallJob } from '@rhapsode/contract';

import type { CatalogRecord } from '../registry/engines.catalog.js';
import { resolveCommand } from '../workers/worker.handle.js';

export type InstallStep = NonNullable<InstallJob['step']>;

/** One command an install runs, and the step a job reports while it runs. */
export interface PlannedCommand {
    step: InstallStep;
    command: string;
    args: string[];
}

export interface InstallPlan {
    venv: string;
    commands: PlannedCommand[];
}

export interface PlanInputs {
    id: string;
    record: CatalogRecord;
    /** `<venvDir>/<id>` is where the engine's virtualenv goes. */
    venv: string;
    /** The interpreter that creates it. */
    python: string;
    /** Whether `uv` is on the path, which makes creating a virtualenv several seconds faster. */
    uv: boolean;
    /** From `RHAPSODE_PIP_TRUSTED_HOSTS` on the server, never from a request. */
    trustedHosts: string[];
    /** Where to install the SDK and the adapter from: a directory if one was found, else a name. */
    sources: { sdk: string; adapter: string };
}

/** The worker SDK every adapter depends on. Installed alongside it because it is not yet published. */
export const SDK_PACKAGE = 'rhapsode-worker';

/**
 * Every command an install runs, in order, as data.
 *
 * Pure so that what an install does is testable without running pip. It mirrors
 * `scripts/python.mjs`, which builds the development virtualenv, and ends with the check the doctor
 * makes: importing the engine's module with the new interpreter, which is the command the core will
 * spawn minus serving.
 */
export function planInstall(inputs: PlanInputs): InstallPlan {
    const { venv, python, uv, trustedHosts, sources, record } = inputs;
    const interpreter = resolveCommand({
        id: inputs.id,
        displayName: record.displayName,
        license: record.license,
        venv,
        module: record.module,
    }).command;
    const trusted = trustedHosts.flatMap(host => ['--trusted-host', host]);
    const pip = (...args: string[]): PlannedCommand => ({
        step: 'packages',
        command: interpreter,
        // A progress bar is a line rewritten in place, which becomes hundreds of lines on a feed.
        args: ['-m', 'pip', 'install', '--progress-bar', 'off', ...trusted, ...args],
    });

    return {
        venv,
        commands: [
            uv
                ? // --seed, because a uv virtualenv has no pip otherwise and every later step is pip.
                  { step: 'venv', command: 'uv', args: ['venv', '--seed', '--python', python, venv] }
                : { step: 'venv', command: python, args: ['-m', 'venv', venv] },
            pip('--upgrade', 'pip'),
            // Both in one resolve. The adapter depends on rhapsode-worker by name, and naming a
            // directory that provides it in the same command is what lets pip satisfy that without
            // going to an index that does not have it yet.
            pip(sources.sdk, sources.adapter),
            { step: 'verify', command: interpreter, args: ['-c', `import ${record.module}`] },
        ],
    };
}
