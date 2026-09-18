import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CatalogEntry, InstallJob } from '@rhapsode/contract';

import { RhapsodeJsonLogger } from '../src/logging/rhapsode.logger.js';
import type { CommandRunner } from '../src/install/command.runner.js';
import { installEnvironment } from '../src/install/command.runner.js';
import { planInstall, type PlannedCommand } from '../src/install/install.plan.js';
import { checkoutPythonDir, resolveInstallSettings, sourceFor } from '../src/install/install.settings.js';
import { CATALOG } from '../src/registry/engines.catalog.js';
import { loadSettings, MANAGED_FILE } from '../src/registry/managed.engines.js';
import { buildServer } from '../src/server.js';
import type { RhapsodeConfig } from '../src/config.js';

const silent = () => new RhapsodeJsonLogger('error', () => {});

describe('planInstall', () => {
    const base = {
        id: 'chatterbox',
        record: CATALOG.chatterbox!,
        venv: '/v/chatterbox',
        python: 'python3',
        uv: false,
        trustedHosts: [],
        sources: { sdk: '/src/rhapsode-worker', adapter: '/src/rhapsode-engine-chatterbox' },
    };

    it('creates the venv, installs the SDK and adapter together, and ends by importing the module', () => {
        const { commands } = planInstall(base);

        expect(commands.map(command => command.step)).toEqual(['venv', 'packages', 'packages', 'verify']);
        expect(commands[0]).toEqual({ step: 'venv', command: 'python3', args: ['-m', 'venv', '/v/chatterbox'] });
        expect(commands[2]!.args.slice(-2)).toEqual(['/src/rhapsode-worker', '/src/rhapsode-engine-chatterbox']);
        expect(commands[3]).toEqual({ step: 'verify', command: '/v/chatterbox/bin/python', args: ['-c', 'import rhapsode_engine_chatterbox'] });
    });

    it('seeds pip into a uv venv, because every later step is pip', () => {
        const { commands } = planInstall({ ...base, uv: true });
        expect(commands[0]).toEqual({ step: 'venv', command: 'uv', args: ['venv', '--seed', '--python', 'python3', '/v/chatterbox'] });
    });

    it('passes trusted hosts to every pip command and nothing else', () => {
        const { commands } = planInstall({ ...base, trustedHosts: ['pypi.org', 'files.pythonhosted.org'] });
        const pips = commands.filter(command => command.step === 'packages');

        for (const pip of pips)
            expect(pip.args).toEqual(expect.arrayContaining(['--trusted-host', 'pypi.org', '--trusted-host', 'files.pythonhosted.org']));
        expect(commands[0]!.args).not.toContain('--trusted-host');
    });
});

describe('install settings', () => {
    it('finds the checkout’s python directory from inside the checkout', () => {
        const found = checkoutPythonDir();
        expect(found).toBeDefined();
        expect(existsSync(join(found!, 'rhapsode-worker', 'pyproject.toml'))).toBe(true);
    });

    it('installs from a source directory when the package is there, and by name when it is not', () => {
        const python = checkoutPythonDir()!;
        expect(sourceFor('rhapsode-engine-tone', python)).toBe(join(python, 'rhapsode-engine-tone'));
        expect(sourceFor('rhapsode-engine-nothing', python)).toBe('rhapsode-engine-nothing');
        expect(sourceFor('rhapsode-engine-tone', undefined)).toBe('rhapsode-engine-tone');
    });

    it('reads trusted hosts from the server’s environment', () => {
        expect(resolveInstallSettings({}, { RHAPSODE_PIP_TRUSTED_HOSTS: ' pypi.org, ,files.pythonhosted.org' }).trustedHosts).toEqual([
            'pypi.org',
            'files.pythonhosted.org',
        ]);
        expect(resolveInstallSettings({}, {}).trustedHosts).toEqual([]);
    });

    it('never hands pip the server’s virtualenv', () => {
        const env = installEnvironment({ PATH: '/bin', VIRTUAL_ENV: '/wrong', PYTHONPATH: '/wrong', HTTPS_PROXY: 'http://proxy:3128' });
        expect(env).not.toHaveProperty('VIRTUAL_ENV');
        expect(env).not.toHaveProperty('PYTHONPATH');
        expect(env.HTTPS_PROXY).toBe('http://proxy:3128');
    });
});

/** A runner that makes the venv directory, records what it ran, and can be told to fail or wait. */
function fakeRunner(options: { failAt?: PlannedCommand['step']; hold?: Promise<void> } = {}) {
    const ran: PlannedCommand[] = [];
    const runner: CommandRunner = async (command, onLine) => {
        ran.push(command);
        await options.hold;
        onLine(`ran ${command.step}`, 'stdout');
        if (command.step === options.failAt) throw new Error('pip exited 1: ERROR: No matching distribution found for rhapsode-worker');
        if (command.step === 'venv') mkdirSync(command.args.at(-1)!, { recursive: true });
    };
    return { runner, ran };
}

describe('the install routes', () => {
    let dir: string;
    let venvDir: string;
    let running: Awaited<ReturnType<typeof buildServer>> | undefined;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'rh-install-'));
        venvDir = join(dir, 'venvs');
    });

    afterEach(async () => {
        await running?.app.close();
        running = undefined;
        rmSync(dir, { recursive: true, force: true });
    });

    async function start(runner: CommandRunner, operator: RhapsodeConfig = {}) {
        const configPath = join(dir, 'rhapsode.config.json');
        if (operator.engines !== undefined) {
            const { writeFileSync } = await import('node:fs');
            writeFileSync(configPath, JSON.stringify(operator));
        }
        const { settings, managed } = await loadSettings(configPath);
        const builder = await buildServer({ ...settings, install: { venvDir } }, silent(), { managed, runner });
        running = builder;
        await builder.app.ready();
        return builder.app;
    }

    async function settled(app: Awaited<ReturnType<typeof start>>, id: string): Promise<InstallJob> {
        for (let attempt = 0; attempt < 200; attempt += 1) {
            const job = InstallJob.parse((await app.inject({ method: 'GET', url: `/installs/${id}` })).json());
            if (job.state === 'succeeded' || job.state === 'failed') return job;
            await new Promise(fulfil => setTimeout(fulfil, 10));
        }
        throw new Error(`job ${id} never settled`);
    }

    it('installs an engine, records it, and makes it available without a restart', async () => {
        const { runner, ran } = fakeRunner();
        const app = await start(runner);

        const accepted = await app.inject({ method: 'POST', url: '/engines/tone/install' });
        expect(accepted.statusCode).toBe(202);
        const job = await settled(app, InstallJob.parse(accepted.json()).id);

        expect(job).toMatchObject({ state: 'succeeded', step: 'register', engine: 'tone', kind: 'install' });
        expect(ran.map(command => command.step)).toEqual(['venv', 'packages', 'packages', 'verify']);

        const recorded = JSON.parse(readFileSync(join(dir, MANAGED_FILE), 'utf8'));
        expect(recorded).toEqual({ engines: { tone: { venv: join(venvDir, 'tone') } } });

        const engines = (await app.inject({ method: 'GET', url: '/engines' })).json();
        expect(engines.map((engine: { id: string }) => engine.id)).toEqual(['tone']);

        const catalog: CatalogEntry[] = (await app.inject({ method: 'GET', url: '/catalog' })).json();
        expect(catalog.find(entry => entry.id === 'tone')).toMatchObject({ installed: 'yes', managed: true });
    });

    it('reports a failed step with the command’s own last word, and registers nothing', async () => {
        const { runner } = fakeRunner({ failAt: 'packages' });
        const app = await start(runner);

        const accepted = await app.inject({ method: 'POST', url: '/engines/chatterbox/install' });
        const job = await settled(app, accepted.json().id);

        expect(job).toMatchObject({ state: 'failed', step: 'packages' });
        expect(job.error).toMatchObject({ code: 'internal', retryable: false });
        expect(job.error?.message).toMatch(/No matching distribution found/);
        expect(existsSync(join(dir, MANAGED_FILE))).toBe(false);
        expect((await app.inject({ method: 'GET', url: '/engines' })).json()).toEqual([]);
    });

    it('says installing while it is, and refuses a second install of the same engine', async () => {
        let release!: () => void;
        const { runner } = fakeRunner({ hold: new Promise<void>(fulfil => (release = fulfil)) });
        const app = await start(runner);

        const first = (await app.inject({ method: 'POST', url: '/engines/tone/install' })).json();
        const catalog: CatalogEntry[] = (await app.inject({ method: 'GET', url: '/catalog' })).json();
        expect(catalog.find(entry => entry.id === 'tone')?.installed).toBe('installing');

        const second = await app.inject({ method: 'POST', url: '/engines/tone/install' });
        expect(second.statusCode).toBe(409);
        expect(second.json().error).toMatchObject({ code: 'conflict' });
        expect(second.json().error.message).toContain(first.id);

        release();
        await settled(app, first.id);
        const third = await app.inject({ method: 'POST', url: '/engines/tone/install' });
        expect(third.json().error.message).toMatch(/already installed/);
    });

    it('runs one job at a time, in the order they arrived', async () => {
        let release!: () => void;
        const { runner, ran } = fakeRunner({ hold: new Promise<void>(fulfil => (release = fulfil)) });
        const app = await start(runner);

        const tone = (await app.inject({ method: 'POST', url: '/engines/tone/install' })).json();
        const chatterbox = (await app.inject({ method: 'POST', url: '/engines/chatterbox/install' })).json();
        expect((await app.inject({ method: 'GET', url: `/installs/${chatterbox.id}` })).json().state).toBe('queued');

        release();
        await settled(app, chatterbox.id);
        const firstOfChatterbox = ran.findIndex(command => command.args.includes(join(venvDir, 'chatterbox')));
        const lastOfTone = ran.findLastIndex(command => command.command.startsWith(join(venvDir, 'tone')));
        expect(lastOfTone).toBeLessThan(firstOfChatterbox);
        expect((await app.inject({ method: 'GET', url: '/installs' })).json().map((job: InstallJob) => job.id)).toEqual([chatterbox.id, tone.id]);
    });

    it('uninstalls what it installed: worker, registry, managed file, and venv', async () => {
        const { runner } = fakeRunner();
        const app = await start(runner);
        await settled(app, (await app.inject({ method: 'POST', url: '/engines/tone/install' })).json().id);
        expect(existsSync(join(venvDir, 'tone'))).toBe(true);

        const removed = await app.inject({ method: 'DELETE', url: '/engines/tone' });

        expect(removed.statusCode).toBe(204);
        expect(existsSync(join(venvDir, 'tone'))).toBe(false);
        expect(JSON.parse(readFileSync(join(dir, MANAGED_FILE), 'utf8'))).toEqual({ engines: {} });
        expect((await app.inject({ method: 'GET', url: '/engines' })).json()).toEqual([]);
    });

    it('will not uninstall an engine the operator configured', async () => {
        const app = await start(fakeRunner().runner, { engines: { tone: { venv: '/somewhere/else' } } });
        const response = await app.inject({ method: 'DELETE', url: '/engines/tone' });

        expect(response.statusCode).toBe(409);
        expect(response.json().error.message).toMatch(/operator's config file/);
    });

    it('will not install over an engine the operator configured', async () => {
        const app = await start(fakeRunner().runner, { engines: { tone: { venv: '/somewhere/else', enabled: false } } });
        expect((await app.inject({ method: 'POST', url: '/engines/tone/install' })).statusCode).toBe(409);
    });

    it('names what it has when asked for an engine it does not', async () => {
        const app = await start(fakeRunner().runner);

        const install = await app.inject({ method: 'POST', url: '/engines/dia/install' });
        expect(install.statusCode).toBe(404);
        expect(install.json().error).toMatchObject({ code: 'unknown_engine' });

        expect((await app.inject({ method: 'DELETE', url: '/engines/chatterbox' })).statusCode).toBe(404);
        expect((await app.inject({ method: 'GET', url: '/installs/nope' })).statusCode).toBe(404);
    });

    it('refuses every management route to a remote caller', async () => {
        const app = await start(fakeRunner().runner);
        const remote = { remoteAddress: '10.0.0.5' };

        expect((await app.inject({ method: 'POST', url: '/engines/tone/install', ...remote })).statusCode).toBe(403);
        expect((await app.inject({ method: 'DELETE', url: '/engines/tone', ...remote })).statusCode).toBe(403);
        expect((await app.inject({ method: 'GET', url: '/installs', ...remote })).statusCode).toBe(403);
        expect((await app.inject({ method: 'GET', url: '/installs/x', ...remote })).statusCode).toBe(403);
    });

    it('cannot install on a server built without a managed file', async () => {
        const builder = await buildServer({ install: { venvDir } }, silent(), { runner: fakeRunner().runner });
        running = builder;
        await builder.app.ready();

        const response = await builder.app.inject({ method: 'POST', url: '/engines/tone/install' });
        expect(response.statusCode).toBe(422);
        expect(response.json().error.code).toBe('unsupported');
    });
});
