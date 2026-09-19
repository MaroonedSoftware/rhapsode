import { rm } from 'node:fs/promises';
import { join, relative, isAbsolute } from 'node:path';

import type { InstallJob } from '@rhapsode/contract';

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

    /** Queue an install. Everything that can be refused is refused here, before a job exists. */
    install(id: string): InstallJob {
        const record = catalogued(id);
        this.refuseIfBusy(id);
        if (this.managed.isOperatorOwned(id)) {
            throw new RhapsodeError('conflict', `"${id}" is configured in the operator's config file, which is theirs to change`);
        }
        if (this.engines.has(id)) throw new RhapsodeError('conflict', `"${id}" is already installed`);
        if (this.managed.path === undefined) {
            throw new RhapsodeError('unsupported', 'this server was started without a managed engines file, so it has nowhere to record an install');
        }

        return this.jobs.submit('install', id, undefined, context => this.run(id, record, context));
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

        return this.jobs.submit('pull', id, chosen, async context => {
            context.step('weights');
            context.line(`fetching ${id} ${chosen}`);
            const client = await this.workers.client(id);
            await client.fetch(chosen, context.signal);
        });
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
        if (venv !== undefined && inside(venv, this.settings.venvDir)) await rm(venv, { recursive: true, force: true });
    }

    private refuseIfBusy(id: string): void {
        const pending = this.jobs.pending(id);
        if (pending !== undefined) throw new RhapsodeError('conflict', `"${id}" already has a ${pending.kind} ${pending.state}, job ${pending.id}`);
    }

    private async run(id: string, record: CatalogRecord, context: JobContext): Promise<void> {
        const venv = join(this.settings.venvDir, id);

        context.step('venv');
        // Nothing registered points here, or install() would have refused. So a directory already
        // here is what an install that did not finish left behind, and building over it would mix
        // two attempts' packages.
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

        context.step('register');
        const configured = { venv };
        const entry = entryFrom(id, configured);
        await this.managed.record(id, configured);
        await this.workers.forget(id);
        this.engines.declare(entry);
    }
}

function catalogued(id: string): CatalogRecord {
    const record = CATALOG[id];
    if (record === undefined) throw RhapsodeError.unknownEngine(id, Object.keys(CATALOG));
    return record;
}

/** Whether a path is strictly inside a directory, so an uninstall never deletes the directory itself or anything outside it. */
function inside(path: string, directory: string): boolean {
    const between = relative(directory, path);
    return between !== '' && !between.startsWith('..') && !isAbsolute(between);
}
