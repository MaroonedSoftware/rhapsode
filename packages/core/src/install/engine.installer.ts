import { rm } from 'node:fs/promises';
import { join, relative, isAbsolute } from 'node:path';

import type { InstallJob, ReinstallOutdated } from '@rhapsode/contract';

import { RhapsodeError } from '../errors/rhapsode.error.js';
import { entryFrom } from '../registry/engine.module.js';
import { EngineRegistry } from '../registry/engine.registry.js';
import { CATALOG, type CatalogRecord } from '../registry/engines.catalog.js';
import { ManagedEngines } from '../registry/managed.engines.js';
import { ResidencyManager } from '../residency/residency.manager.js';
import { WorkerRegistry } from '../workers/worker.registry.js';
import type { CommandRunner } from './command.runner.js';
import { InstallJobs, type JobContext } from './install.jobs.js';
import { CORE_VERSION } from '../core.version.js';
import { planInstall, SDK_PACKAGE } from './install.plan.js';
import { onPath, sourceFor, type InstallSettings } from './install.settings.js';

/**
 * How long a reinstall's `register` waits for the engine to stop speaking before it gives up. Long
 * enough for any one request, including a dialogue, to finish; a box that has spoken without pause
 * for ten minutes is one where the reinstall should be retried later rather than forced. § 10.
 */
const REPLACE_WAIT_SECONDS = 600;

/** Installs and removes engines. protocol.md § 10. */
export class EngineInstaller {
    constructor(
        private readonly engines: EngineRegistry,
        private readonly workers: WorkerRegistry,
        private readonly residency: ResidencyManager,
        private readonly managed: ManagedEngines,
        private readonly jobs: InstallJobs,
        private readonly settings: InstallSettings,
        private readonly runner: CommandRunner,
    ) {}

    /**
     * Queue an install. Everything that can be refused is refused here, before a job exists.
     *
     * With `pull`, a variant, the job fetches it once the engine is registered. `accept` is the
     * weights licence the caller accepts, as the query carried it. § 10.
     */
    install(id: string, pull?: string, accept?: unknown): InstallJob {
        const record = catalogued(id);
        refuseUnaccepted(id, record, accept);
        this.refuseIfBusy(id);
        if (this.managed.isOperatorOwned(id)) {
            throw new RhapsodeError('conflict', `"${id}" is configured in the operator's config file, which is theirs to change`);
        }
        if (this.engines.has(id)) throw new RhapsodeError('conflict', `"${id}" is already installed`);
        if (this.managed.path === undefined) {
            throw new RhapsodeError('unsupported', 'this server was started without a managed engines file, so it has nowhere to record an install');
        }

        const accepted = typeof accept === 'string' ? accept : undefined;
        return this.jobs.submit('install', id, pull, async context => {
            await this.run(id, record, accepted, context);
            if (pull !== undefined) await this.installWeights(id, pull, context);
        });
    }

    /**
     * Queue a rebuild of an installed engine in its other slot, swapped in once it imports. § 10.
     *
     * The engine keeps working from its old virtualenv until `register`, and a failure before that
     * changes nothing. It is the remedy for `outdated` (§ 9), and for a virtualenv somebody broke.
     */
    reinstall(id: string, accept?: unknown): InstallJob {
        if (!this.engines.has(id)) throw RhapsodeError.unknownEngine(id, this.engines.ids());
        const record = catalogued(id);
        if (!this.managed.isManaged(id)) {
            throw new RhapsodeError('conflict', `"${id}" is configured in the operator's config file; rebuild its virtualenv there`);
        }
        // No managed-file check, unlike install: a server without one has managed nothing, so every
        // engine it has is the operator's and was refused above.
        this.refuseIfBusy(id);
        const accepted = acceptanceFor(id, record, this.managed.entry(id)?.accepted, accept);

        return this.jobs.submit('reinstall', id, undefined, context => this.rebuild(id, record, accepted, context));
    }

    /**
     * Queue a reinstall for every `outdated` engine this API installed, in id order. § 10.
     *
     * Never refuses as a whole. An engine that a single reinstall would have to ask somebody about is
     * skipped and named, and nothing behind is an empty answer, so a cron line can end with this.
     */
    reinstallOutdated(): ReinstallOutdated {
        const answer: ReinstallOutdated = { jobs: [], skipped: [] };
        for (const id of this.engines.ids().sort()) {
            if (this.engines.outdated(id) !== true || !this.managed.isManaged(id)) continue;
            const record = CATALOG[id];
            if (record === undefined) {
                answer.skipped.push({ engine: id, reason: 'uncatalogued' });
            } else if (this.jobs.pending(id) !== undefined) {
                answer.skipped.push({ engine: id, reason: 'busy' });
            } else if (!coveredWithoutAsking(id, record, this.managed.entry(id)?.accepted)) {
                answer.skipped.push({ engine: id, reason: 'licence' });
            } else {
                const accepted = this.managed.entry(id)?.accepted;
                answer.jobs.push(this.jobs.submit('reinstall', id, undefined, context => this.rebuild(id, record, accepted, context)));
            }
        }
        return answer;
    }

    /**
     * Queue a download of a variant's weights, so a first `/speak` does not sit through it.
     *
     * The worker is started if it is not running, which costs tens of megabytes, and nothing is
     * loaded, so this takes no residency slot and evicts nobody. An engine whose adapter does not
     * fetch fails the job with `unsupported`, and its weights arrive on first load as before.
     */
    pull(id: string, variant: string | undefined): InstallJob {
        if (!this.engines.has(id)) throw RhapsodeError.unknownEngine(id, this.engines.ids());
        this.refuseIfBusy(id);
        const chosen = variant ?? this.engines.entry(id)?.defaultVariant;
        if (chosen === undefined) throw new RhapsodeError('bad_request', `"${id}" has no default variant, so name the one to pull`);

        return this.jobs.submit('pull', id, chosen, context => this.fetch(id, chosen, context));
    }

    /**
     * Stop an engine, forget it, and delete its virtualenv if this API made it.
     *
     * Synchronous rather than a job, because none of it waits on the network. Weights are left where
     * the engine put them: they sit in a cache other tools on the box share.
     */
    async uninstall(id: string): Promise<void> {
        if (!this.engines.has(id)) throw RhapsodeError.unknownEngine(id, this.engines.ids());
        if (!this.managed.isManaged(id)) {
            throw new RhapsodeError('conflict', `"${id}" is configured in the operator's config file; remove it there`);
        }
        this.refuseIfBusy(id);

        const venv = this.engines.entry(id)?.venv;
        await this.residency.forget(id, async () => {
            await this.workers.forget(id);
            this.engines.remove(id);
        });
        await this.managed.forget(id);
        // Both slots, so the remains of a reinstall that did not finish go with the engine. § 10.
        for (const slot of new Set([venv, ...this.slots(id)])) {
            if (slot !== undefined && inside(slot, this.settings.venvDir)) await rm(slot, { recursive: true, force: true });
        }
    }

    private async fetch(id: string, variant: string, context: JobContext): Promise<void> {
        context.step('weights');
        context.line(`fetching ${id} ${variant}`);
        const client = await this.workers.client(id);
        await client.fetch(variant, context.signal);
    }

    /**
     * An install's step 5. The engine is registered by now, so a failure here fails the job and
     * leaves the engine installed, for a pull to finish. An adapter that cannot fetch is not a
     * failure of the install: its weights arrive on first load, as they would have without asking.
     */
    private async installWeights(id: string, variant: string, context: JobContext): Promise<void> {
        try {
            await this.fetch(id, variant, context);
        } catch (error) {
            if (!(error instanceof RhapsodeError) || error.code !== 'unsupported') throw error;
            context.line(`${id} does not download ahead of time; its weights arrive on its first load`);
        }
    }

    private refuseIfBusy(id: string): void {
        const pending = this.jobs.pending(id);
        if (pending !== undefined) throw new RhapsodeError('conflict', `"${id}" already has a ${pending.kind} ${pending.state}, job ${pending.id}`);
    }

    /**
     * The two virtualenvs an engine can run from: `<id>`, and `<id>.alt` for a reinstall to build in
     * while the engine keeps running from the first. Two fixed paths rather than one per version,
     * because a reinstall at the version already installed would otherwise build over the live one.
     */
    private slots(id: string): [string, string] {
        return [join(this.settings.venvDir, id), join(this.settings.venvDir, `${id}.alt`)];
    }

    private async run(id: string, record: CatalogRecord, accepted: string | undefined, context: JobContext): Promise<void> {
        const [venv, other] = this.slots(id);

        context.step('venv');
        // Nothing registered points at either slot, or install() would have refused. So a directory
        // already in one is what an install or a reinstall that did not finish left behind.
        await rm(other, { recursive: true, force: true });
        await this.build(id, record, venv, context);

        context.step('register');
        const configured = { venv, ...(accepted === undefined ? {} : { accepted }) };
        const entry = entryFrom(id, configured);
        await this.managed.record(id, configured);
        await this.workers.forget(id);
        this.engines.declare(entry);
    }

    private async rebuild(id: string, record: CatalogRecord, accepted: string | undefined, context: JobContext): Promise<void> {
        const current = this.engines.entry(id)?.venv;
        const [primary, alternate] = this.slots(id);
        const next = current === primary ? alternate : primary;
        await this.build(id, record, next, context);

        context.step('register');
        const { accepted: _previous, ...kept } = this.managed.entry(id) ?? {};
        const configured = { ...kept, venv: next, ...(accepted === undefined ? {} : { accepted }) };
        const entry = entryFrom(id, configured);
        let swapping = false;
        try {
            await this.residency.replace(
                id,
                async () => {
                    swapping = true;
                    // The managed file first, so a core that dies anywhere after this boots on the new
                    // virtualenv, and one that dies before it boots on the old.
                    await this.managed.record(id, configured);
                    await this.workers.forget(id);
                    // Removed and declared rather than declared over, so the restarts and the last
                    // error of the worker just stopped are not reported against the new one.
                    this.engines.remove(id);
                    this.engines.declare(entry);
                },
                REPLACE_WAIT_SECONDS,
            );
        } catch (error) {
            // Gave up waiting before anything was touched: the new slot is not the live one, and
            // several GB of it is not worth keeping until the next attempt clears it.
            if (!swapping) await rm(next, { recursive: true, force: true });
            throw error;
        }
        if (current !== undefined && current !== next && inside(current, this.settings.venvDir)) {
            await rm(current, { recursive: true, force: true });
        }
    }

    /** Steps 1 to 3 into `venv`: create it, install the SDK and the adapter, and import the engine. */
    private async build(id: string, record: CatalogRecord, venv: string, context: JobContext): Promise<void> {
        if (context.job.step !== 'venv') context.step('venv');
        // Whatever is here is not registered, so it is the remains of an attempt that did not finish,
        // and building over it would mix two attempts' packages.
        await rm(venv, { recursive: true, force: true });

        const plan = planInstall({
            id,
            record,
            venv,
            python: this.settings.python,
            uv: await onPath('uv'),
            trustedHosts: this.settings.trustedHosts,
            sources: {
                sdk: sourceFor(SDK_PACKAGE, this.settings.sourceDir, CORE_VERSION),
                adapter: sourceFor(record.package, this.settings.sourceDir, CORE_VERSION),
            },
        });

        for (const command of plan.commands) {
            if (context.job.step !== command.step) context.step(command.step);
            context.line(`$ ${command.command} ${command.args.join(' ')}`);
            await this.runner(command, line => context.line(line), context.signal);
        }
    }
}

function catalogued(id: string): CatalogRecord {
    const record = CATALOG[id];
    if (record === undefined) throw RhapsodeError.unknownEngine(id, Object.keys(CATALOG));
    return record;
}

/**
 * Refuse an install whose weights may not be used commercially unless it names their licence, and
 * any `accept` that names something else. Named rather than a flag, so what is accepted is the
 * licence the client displayed, and a catalog relicensed since the client read it refuses. § 10.
 */
export function refuseUnaccepted(id: string, record: CatalogRecord, accept: unknown): void {
    const { weights, weightsCommercialUse } = record.license;
    if (accept === undefined && weightsCommercialUse) return;
    if (accept === weights) return;
    const query = `?accept=${encodeURIComponent(weights)}`;
    if (accept === undefined) {
        throw new RhapsodeError(
            'bad_request',
            `"${id}" has weights under ${weights}, which may not be used commercially. Install it with ${query} to accept that licence`,
        );
    }
    throw new RhapsodeError('bad_request', `\`accept\` names the weights licence, which for "${id}" is ${weights}: ${query}`);
}

/**
 * The licence a reinstall accepts: the one sent, or the one the last install recorded while it is
 * still the licence the catalog names. A catalog relicensed by an upgrade, or an entry recorded by
 * a core that kept no `accepted`, refuses as an install would, because nobody accepted these terms.
 */
export function acceptanceFor(id: string, record: CatalogRecord, recorded: string | undefined, accept: unknown): string | undefined {
    if (accept === undefined && recorded === record.license.weights) return recorded;
    refuseUnaccepted(id, record, accept);
    return typeof accept === 'string' ? accept : undefined;
}

/** Whether a reinstall of this engine needs no `accept`. */
function coveredWithoutAsking(id: string, record: CatalogRecord, recorded: string | undefined): boolean {
    try {
        acceptanceFor(id, record, recorded, undefined);
        return true;
    } catch {
        return false;
    }
}

/** Whether a path is strictly inside a directory, so an uninstall never deletes the directory itself or anything outside it. */
function inside(path: string, directory: string): boolean {
    const between = relative(directory, path);
    return between !== '' && !between.startsWith('..') && !isAbsolute(between);
}
