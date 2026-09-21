import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CatalogEntry, InstallJob } from '@rhapsode/contract';

import { CORE_VERSION } from '../src/core.version.js';
import type { CommandRunner } from '../src/install/command.runner.js';
import type { PlannedCommand } from '../src/install/install.plan.js';
import { RhapsodeJsonLogger } from '../src/logging/rhapsode.logger.js';
import { CATALOG } from '../src/registry/engines.catalog.js';
import { loadSettings, MANAGED_FILE } from '../src/registry/managed.engines.js';
import { buildServer } from '../src/server.js';
import type { RhapsodeConfig } from '../src/config.js';

const silent = () => new RhapsodeJsonLogger('error', () => {});

/** Where a venv keeps `rhapsode-worker`'s metadata, which is all `workerVersion` reads. § 9. */
function writeWorkerVersion(venv: string, version: string): void {
    mkdirSync(join(venv, 'lib', 'python3.12', 'site-packages', `rhapsode_worker-${version}.dist-info`), { recursive: true });
}

/**
 * A runner that builds a venv with `rhapsode-worker` at `options.version` in it, so a test can make
 * an engine that an upgrade left behind and then reinstall it at this core's version.
 */
function fakeRunner(options: { version: string; failAt?: PlannedCommand['step']; hold?: Promise<void> }) {
    const ran: PlannedCommand[] = [];
    const runner: CommandRunner = async command => {
        ran.push(command);
        await options.hold;
        if (command.step === options.failAt) throw new Error('pip exited 1: ERROR: No matching distribution found for rhapsode-worker');
        if (command.step === 'venv') {
            const venv = command.args.at(-1)!;
            mkdirSync(join(venv, 'bin'), { recursive: true });
            writeWorkerVersion(venv, options.version);
        }
    };
    return { runner, ran };
}

describe('reinstalling an engine', () => {
    let dir: string;
    let venvDir: string;
    let running: Awaited<ReturnType<typeof buildServer>> | undefined;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'rh-reinstall-'));
        venvDir = join(dir, 'venvs');
    });

    afterEach(async () => {
        await running?.app.close();
        running = undefined;
        rmSync(dir, { recursive: true, force: true });
    });

    async function start(runner: CommandRunner, operator: RhapsodeConfig = {}) {
        const configPath = join(dir, 'rhapsode.config.json');
        if (operator.engines !== undefined) writeFileSync(configPath, JSON.stringify(operator));
        const { settings, managed } = await loadSettings(configPath);
        const builder = await buildServer({ ...settings, workers: { socketDir: join(dir, 's') }, install: { venvDir } }, silent(), {
            managed,
            runner,
        });
        running = builder;
        await builder.app.ready();
        return builder.app;
    }

    type App = Awaited<ReturnType<typeof start>>;

    async function settled(app: App, id: string): Promise<InstallJob> {
        for (let attempt = 0; attempt < 200; attempt += 1) {
            const job = InstallJob.parse((await app.inject({ method: 'GET', url: `/installs/${id}` })).json());
            if (job.state === 'succeeded' || job.state === 'failed') return job;
            await new Promise(fulfil => setTimeout(fulfil, 10));
        }
        throw new Error(`job ${id} never settled`);
    }

    const post = (app: App, url: string) => app.inject({ method: 'POST', url });
    const catalogEntry = async (app: App, id: string) =>
        ((await app.inject({ method: 'GET', url: '/catalog' })).json() as CatalogEntry[]).find(entry => entry.id === id);
    const managedEntry = (id: string) => JSON.parse(readFileSync(join(dir, MANAGED_FILE), 'utf8')).engines[id];

    /** Install `id` with a worker from an older release, as an upgraded box has it. */
    async function installStale(app: App, options: { version: string }, id = 'tone', query = '') {
        const job = await settled(app, (await post(app, `/engines/${id}/install${query}`)).json().id);
        expect(job.state).toBe('succeeded');
        options.version = CORE_VERSION;
    }

    it('rebuilds an engine an upgrade left behind in its other slot, and swaps it in', async () => {
        const options = { version: '0.0.1' };
        const { runner, ran } = fakeRunner(options);
        const app = await start(runner);
        await installStale(app, options);
        expect(await catalogEntry(app, 'tone')).toMatchObject({ workerVersion: '0.0.1', outdated: true });

        const accepted = await post(app, '/engines/tone/reinstall');
        expect(accepted.statusCode).toBe(202);
        const job = await settled(app, accepted.json().id);

        expect(job).toMatchObject({ state: 'succeeded', kind: 'reinstall', step: 'register', engine: 'tone' });
        expect(ran.slice(4).map(command => command.step)).toEqual(['venv', 'packages', 'packages', 'verify']);
        expect(ran[4]?.args.at(-1)).toBe(join(venvDir, 'tone.alt'));
        expect(managedEntry('tone')).toEqual({ venv: join(venvDir, 'tone.alt') });
        expect(existsSync(join(venvDir, 'tone'))).toBe(false);
        expect(await catalogEntry(app, 'tone')).toMatchObject({ installed: 'yes', workerVersion: CORE_VERSION, outdated: false });
    });

    it('flips back to the first slot on the next reinstall, so there are never more than two', async () => {
        const options = { version: '0.0.1' };
        const app = await start(fakeRunner(options).runner);
        await installStale(app, options);

        await settled(app, (await post(app, '/engines/tone/reinstall')).json().id);
        await settled(app, (await post(app, '/engines/tone/reinstall')).json().id);

        expect(managedEntry('tone').venv).toBe(join(venvDir, 'tone'));
        expect(existsSync(join(venvDir, 'tone.alt'))).toBe(false);
    });

    it('keeps the engine working from its old virtualenv while it builds, and says installed throughout', async () => {
        const options: { version: string; hold?: Promise<void> } = { version: '0.0.1' };
        const app = await start(fakeRunner(options).runner);
        await installStale(app, options);

        let release!: () => void;
        options.hold = new Promise<void>(fulfil => (release = fulfil));
        const job = (await post(app, '/engines/tone/reinstall')).json();

        expect(await catalogEntry(app, 'tone')).toMatchObject({ installed: 'yes', workerVersion: '0.0.1' });
        expect((await app.inject({ method: 'GET', url: '/engines' })).json()[0]).toMatchObject({ id: 'tone', workerVersion: '0.0.1' });
        release();
        expect((await settled(app, job.id)).state).toBe('succeeded');
    });

    it('changes nothing when the build fails, and the next attempt clears what it left', async () => {
        const options: { version: string; failAt?: PlannedCommand['step'] } = { version: '0.0.1' };
        const app = await start(fakeRunner(options).runner);
        await installStale(app, options);

        options.failAt = 'packages';
        const failed = await settled(app, (await post(app, '/engines/tone/reinstall')).json().id);
        expect(failed).toMatchObject({ state: 'failed', step: 'packages' });
        expect(managedEntry('tone').venv).toBe(join(venvDir, 'tone'));
        expect(existsSync(join(venvDir, 'tone'))).toBe(true);
        expect(await catalogEntry(app, 'tone')).toMatchObject({ workerVersion: '0.0.1', outdated: true });

        options.failAt = undefined;
        expect((await settled(app, (await post(app, '/engines/tone/reinstall')).json().id)).state).toBe('succeeded');
        expect(await catalogEntry(app, 'tone')).toMatchObject({ outdated: false });
    });

    it('refuses an engine that is not installed, or is not in the catalog', async () => {
        const app = await start(fakeRunner({ version: CORE_VERSION }).runner);

        for (const id of ['tone', 'nonesuch']) {
            const refused = await post(app, `/engines/${id}/reinstall`);
            expect(refused.statusCode, id).toBe(404);
            expect(refused.json().error.code, id).toBe('unknown_engine');
        }
    });

    it('refuses an engine the operator configured, which is theirs to rebuild', async () => {
        const app = await start(fakeRunner({ version: CORE_VERSION }).runner, { engines: { tone: { venv: '/somewhere/else' } } });

        const refused = await post(app, '/engines/tone/reinstall');
        expect(refused.statusCode).toBe(409);
        expect(refused.json().error.message).toMatch(/operator's config file/);
    });

    it('refuses an engine with a job already queued or running', async () => {
        const options: { version: string; hold?: Promise<void> } = { version: '0.0.1' };
        const app = await start(fakeRunner(options).runner);
        await installStale(app, options);

        let release!: () => void;
        options.hold = new Promise<void>(fulfil => (release = fulfil));
        const first = (await post(app, '/engines/tone/reinstall')).json();
        const second = await post(app, '/engines/tone/reinstall');

        expect(second.statusCode).toBe(409);
        expect(second.json().error.message).toContain(first.id);
        release();
        await settled(app, first.id);
    });

    it('refuses a remote caller, as every management route does', async () => {
        const app = await start(fakeRunner({ version: CORE_VERSION }).runner);
        const refused = await app.inject({ method: 'POST', url: '/engines/tone/reinstall', remoteAddress: '10.0.0.5' });

        expect(refused.statusCode).toBe(403);
    });

    describe('a weights licence that may not be used commercially', () => {
        beforeEach(() => {
            CATALOG.research = {
                ...CATALOG.tone!,
                displayName: 'Research',
                license: { code: 'MIT', weights: 'CC-BY-NC-4.0', weightsCommercialUse: false },
            };
        });
        afterEach(() => {
            delete CATALOG.research;
        });

        it('asks nothing again while the catalog names the licence that was accepted', async () => {
            const options = { version: '0.0.1' };
            const app = await start(fakeRunner(options).runner);
            await installStale(app, options, 'research', '?accept=CC-BY-NC-4.0');

            const accepted = await post(app, '/engines/research/reinstall');
            expect(accepted.statusCode).toBe(202);
            expect((await settled(app, accepted.json().id)).state).toBe('succeeded');
            expect(managedEntry('research').accepted).toBe('CC-BY-NC-4.0');
        });

        it('asks again when an upgrade relicensed the weights, and records the new acceptance', async () => {
            const options = { version: '0.0.1' };
            const app = await start(fakeRunner(options).runner);
            await installStale(app, options, 'research', '?accept=CC-BY-NC-4.0');
            CATALOG.research!.license = { code: 'MIT', weights: 'CC-BY-NC-SA-4.0', weightsCommercialUse: false };

            const refused = await post(app, '/engines/research/reinstall');
            expect(refused.statusCode).toBe(400);
            expect(refused.json().error.message).toContain('?accept=CC-BY-NC-SA-4.0');

            const accepted = await post(app, '/engines/research/reinstall?accept=CC-BY-NC-SA-4.0');
            expect((await settled(app, accepted.json().id)).state).toBe('succeeded');
            expect(managedEntry('research').accepted).toBe('CC-BY-NC-SA-4.0');
        });

        it('asks for an engine installed by a core that recorded no acceptance', async () => {
            const venv = join(venvDir, 'research');
            writeWorkerVersion(venv, '0.0.1');
            writeFileSync(join(dir, MANAGED_FILE), JSON.stringify({ engines: { research: { venv } } }));
            const app = await start(fakeRunner({ version: CORE_VERSION }).runner);

            expect((await post(app, '/engines/research/reinstall')).statusCode).toBe(400);
            expect((await post(app, '/engines/research/reinstall?accept=CC-BY-NC-4.0')).statusCode).toBe(202);
        });
    });
});
