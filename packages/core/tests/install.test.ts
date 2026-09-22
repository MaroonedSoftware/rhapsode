import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CatalogEntry, InstallJob } from '@rhapsode/contract';

import { CORE_VERSION } from '../src/core.version.js';
import { RhapsodeJsonLogger } from '../src/logging/rhapsode.logger.js';
import type { CommandRunner } from '../src/install/command.runner.js';
import { installEnvironment } from '../src/install/command.runner.js';
import { planInstall, type PlannedCommand } from '../src/install/install.plan.js';
import { checkoutPythonDir, resolveInstallSettings, sourceFor } from '../src/install/install.settings.js';
import { CATALOG } from '../src/registry/engines.catalog.js';
import { loadSettings } from '../src/registry/managed.engines.js';
import { STATE_FILE, StateStore } from '../src/state/state.store.js';
import { buildServer } from '../src/server.js';
import type { RhapsodeConfig } from '../src/config.js';

/** What the server recorded, read through a second handle as a person inspecting the box would. */
function recordedIn(dir: string): { engines: Record<string, unknown> } {
    const store = StateStore.open(join(dir, STATE_FILE));
    try {
        return { engines: Object.fromEntries(store.engines()) };
    } finally {
        store.close();
    }
}

const silent = () => new RhapsodeJsonLogger('error', () => {});

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../..');

/** An install's step 5 starts a real worker, which needs a unix socket the sandbox may refuse. */
const canBindUnixSockets = await (async () => {
    const directory = mkdtempSync(join(tmpdir(), 'rh-probe-'));
    try {
        const server = createServer();
        await new Promise<void>((fulfil, fail) => {
            server.once('error', fail);
            server.listen(join(directory, 'p.sock'), fulfil);
        });
        await new Promise<void>(fulfil => server.close(() => fulfil()));
        return true;
    } catch {
        return false;
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
})();

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

    it('hands uv an engine’s Python range, so it finds or fetches an interpreter inside it', () => {
        const record = { ...CATALOG.chatterbox!, python: { from: '3.10', below: '3.14' } };
        const { commands } = planInstall({ ...base, record, uv: true });

        expect(commands[0]).toEqual({ step: 'venv', command: 'uv', args: ['venv', '--seed', '--python', '>=3.10,<3.14', '/v/chatterbox'] });
    });

    it('asks the interpreter whether it is in range before creating anything, when there is no uv', () => {
        const record = { ...CATALOG.chatterbox!, python: { from: '3.10', below: '3.14' } };
        const { commands } = planInstall({ ...base, record });

        expect(commands.map(command => command.step)).toEqual(['venv', 'venv', 'packages', 'packages', 'verify']);
        expect(commands[0]!.command).toBe('python3');
        expect(commands[0]!.args[0]).toBe('-c');
    });

    it('refuses an interpreter outside the range, in a sentence the job can show', () => {
        // Run for real: the check is a program, and a program is only right if it runs. 3.0 to 3.1
        // excludes whatever runs this test, and 3.0 to 99.0 includes it.
        const check = (below: string) => planInstall({ ...base, record: { ...CATALOG.chatterbox!, python: { from: '3.0', below } } }).commands[0]!;
        const run = (command: PlannedCommand) => spawnSync(command.command, command.args, { encoding: 'utf8' });

        const refused = run(check('3.1'));
        expect(refused.status).toBe(1);
        expect(refused.stderr).toContain('Chatterbox needs Python >=3.0,<3.1 and python3 is 3.');
        expect(refused.stderr).toContain('Install uv');

        expect(run(check('99.0')).status).toBe(0);
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
        expect(sourceFor('rhapsode-engine-tone', python, '0.3.0')).toBe(join(python, 'rhapsode-engine-tone'));
        expect(sourceFor('rhapsode-engine-nothing', python, '0.3.0')).toBe('rhapsode-engine-nothing==0.3.0');
        expect(sourceFor('rhapsode-engine-tone', undefined, '0.3.0')).toBe('rhapsode-engine-tone==0.3.0');
    });

    it('pins what it installs by name to its own version, which is the one in its package.json', () => {
        // § 9: unpinned, pip resolves the newest engine on the index, which may be built for a core
        // this box does not have, and negotiation only refuses it after the install is paid for.
        const own = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../package.json'), 'utf8')).version;
        expect(CORE_VERSION).toBe(own);
    });

    it('ships every catalog engine at its own version, pinning the worker SDK to the same one', () => {
        // § 9: one version across npm and PyPI. What the core installs by name is `package==its own
        // version`, so an engine or SDK left at another number is an install that cannot resolve.
        const python = checkoutPythonDir()!;
        const versionOf = (pkg: string) => /^version = "([^"]+)"/m.exec(readFileSync(join(python, pkg, 'pyproject.toml'), 'utf8'))?.[1];

        expect(versionOf('rhapsode-worker')).toBe(CORE_VERSION);
        for (const record of Object.values(CATALOG)) {
            const pyproject = readFileSync(join(python, record.package, 'pyproject.toml'), 'utf8');
            expect(versionOf(record.package), record.package).toBe(CORE_VERSION);
            expect(/"rhapsode-worker==([^"]+)"/.exec(pyproject)?.[1], record.package).toBe(CORE_VERSION);
        }
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

/**
 * A runner that makes the venv directory, records what it ran, and can be told to fail or wait.
 * Given `python`, the venv's interpreter runs that one, so a worker spawned from it after
 * `register` is real: the development venv's has every adapter the catalog names. A script that
 * execs it rather than a symlink, because Python finds its venv beside the path it was invoked by,
 * and a symlinked interpreter ran bare, without the adapter.
 */
function fakeRunner(options: { failAt?: PlannedCommand['step']; hold?: Promise<void>; python?: string } = {}) {
    const ran: PlannedCommand[] = [];
    const runner: CommandRunner = async (command, onLine) => {
        ran.push(command);
        await options.hold;
        onLine(`ran ${command.step}`, 'stdout');
        if (command.step === options.failAt) throw new Error('pip exited 1: ERROR: No matching distribution found for rhapsode-worker');
        if (command.step === 'venv') {
            const venv = command.args.at(-1)!;
            mkdirSync(join(venv, 'bin'), { recursive: true });
            if (options.python !== undefined) {
                writeFileSync(join(venv, 'bin', 'python'), `#!/bin/sh\nexec '${options.python}' "$@"\n`);
                chmodSync(join(venv, 'bin', 'python'), 0o755);
            }
        }
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
        const workers = { socketDir: join(dir, 's'), startupTimeoutSeconds: 30 };
        const builder = await buildServer({ ...settings, workers, install: { venvDir } }, silent(), { managed, runner });
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
        // Asked for no weights, so it stops at register and names no variant. § 10.
        expect(job.variant).toBeUndefined();
        expect(ran.map(command => command.step)).toEqual(['venv', 'packages', 'packages', 'verify']);

        const recorded = recordedIn(dir);
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
        expect(recordedIn(dir)).toEqual({ engines: {} });
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
        expect(recordedIn(dir)).toEqual({ engines: {} });
        expect((await app.inject({ method: 'GET', url: '/engines' })).json()).toEqual([]);
    });

    it('clears a second slot that a reinstall left behind, when installing and when uninstalling', async () => {
        // `<id>.alt` is where a reinstall builds (§ 10). One that died mid-build leaves it there, and
        // neither a fresh install nor an uninstall may leave it for the next one to trip over.
        mkdirSync(join(venvDir, 'tone.alt', 'bin'), { recursive: true });
        const app = await start(fakeRunner().runner);
        await settled(app, (await app.inject({ method: 'POST', url: '/engines/tone/install' })).json().id);
        expect(existsSync(join(venvDir, 'tone.alt'))).toBe(false);

        mkdirSync(join(venvDir, 'tone.alt', 'bin'), { recursive: true });
        await app.inject({ method: 'DELETE', url: '/engines/tone' });
        expect(existsSync(join(venvDir, 'tone.alt'))).toBe(false);
        expect(existsSync(venvDir)).toBe(true);
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

        const install = await app.inject({ method: 'POST', url: '/engines/nonesuch/install' });
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

    const install = (app: Awaited<ReturnType<typeof start>>, engine: string, query = '') =>
        app.inject({ method: 'POST', url: `/engines/${engine}/install${query}` });

    it('refuses a pull that names no one variant, before a job exists', async () => {
        const { runner, ran } = fakeRunner();
        const app = await start(runner);

        const empty = await install(app, 'tone', '?pull=');
        expect(empty.statusCode).toBe(400);
        expect(empty.json().error.message).toContain('?pull=turbo');
        expect((await install(app, 'tone', '?pull=plain&pull=other')).statusCode).toBe(400);
        expect(ran).toEqual([]);
    });

    it('fails at weights and leaves the engine installed when the download cannot happen', { timeout: 60_000 }, async () => {
        // An interpreter that exits at once: the worker never starts, so its fetch cannot either.
        const broken = join(dir, 'broken-python');
        writeFileSync(broken, '#!/bin/sh\nexit 1\n');
        chmodSync(broken, 0o755);
        const app = await start(fakeRunner({ python: broken }).runner);

        const accepted = await install(app, 'chatterbox', '?pull=turbo');
        expect(accepted.json()).toMatchObject({ kind: 'install', variant: 'turbo' });
        const job = await settled(app, accepted.json().id);

        expect(job).toMatchObject({ state: 'failed', step: 'weights', variant: 'turbo' });
        expect(recordedIn(dir).engines).toHaveProperty('chatterbox');
        const engines = (await app.inject({ method: 'GET', url: '/engines' })).json();
        expect(engines.map((engine: { id: string }) => engine.id)).toEqual(['chatterbox']);
    });

    it.skipIf(!canBindUnixSockets)('succeeds when the engine has no weights to fetch ahead of time', { timeout: 60_000 }, async () => {
        const app = await start(fakeRunner({ python: join(REPO, 'python/.venv/bin/python') }).runner);

        const job = await settled(app, (await install(app, 'tone', '?pull=plain')).json().id);

        expect(job.error).toBeUndefined();
        expect(job).toMatchObject({ state: 'succeeded', step: 'weights', variant: 'plain' });
    });

    describe('a weights licence that may not be used commercially', () => {
        // No catalog engine has such weights yet, so one is added for the length of each test.
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

        it('is refused without accept, before a job exists, naming the licence and the query that accepts it', async () => {
            const { runner, ran } = fakeRunner();
            const app = await start(runner);

            const refused = await install(app, 'research');
            expect(refused.statusCode).toBe(400);
            expect(refused.json().error).toMatchObject({ code: 'bad_request' });
            expect(refused.json().error.message).toContain('CC-BY-NC-4.0');
            expect(refused.json().error.message).toContain('?accept=CC-BY-NC-4.0');
            expect((await app.inject({ method: 'GET', url: '/installs' })).json()).toEqual([]);
            expect(ran).toEqual([]);
        });

        it('installs once accept names the licence exactly', async () => {
            const app = await start(fakeRunner().runner);

            const accepted = await install(app, 'research', '?accept=CC-BY-NC-4.0');
            expect(accepted.statusCode).toBe(202);
            expect(await settled(app, accepted.json().id)).toMatchObject({ state: 'succeeded', engine: 'research' });
        });

        it('records what it accepted, for a reinstall to read', async () => {
            const app = await start(fakeRunner().runner);
            await settled(app, (await install(app, 'research', '?accept=CC-BY-NC-4.0')).json().id);

            const recorded = recordedIn(dir);
            expect(recorded.engines.research).toEqual({ venv: join(venvDir, 'research'), accepted: 'CC-BY-NC-4.0' });
            // And boot ignores it: the engine comes back from the file as any other does.
            expect((await app.inject({ method: 'GET', url: '/engines' })).json()[0]).toMatchObject({ id: 'research' });
        });

        it('refuses an accept that is empty, repeated, or names another licence', async () => {
            const app = await start(fakeRunner().runner);

            for (const query of ['?accept=', '?accept=MIT', '?accept=cc-by-nc-4.0', '?accept=CC-BY-NC-4.0&accept=CC-BY-NC-4.0']) {
                const refused = await install(app, 'research', query);
                expect(refused.statusCode, query).toBe(400);
                expect(refused.json().error.message, query).toContain('?accept=CC-BY-NC-4.0');
            }
        });
    });

    it('needs no accept for commercial weights, and checks one that is sent anyway', async () => {
        const app = await start(fakeRunner().runner);

        expect((await install(app, 'tone', '?accept=GPL-3.0')).statusCode).toBe(400);
        expect((await install(app, 'tone', '?accept=MIT')).statusCode).toBe(202);
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
