#!/usr/bin/env node
// The Python half of the repository, driven from the same command as the TypeScript half.
//
// One repository only means "the protocol and both of its implementations move in one commit" if
// one command tests both, so `pnpm test` ends up here. Prefers uv when it is installed and falls
// back to the stdlib venv module, because a contributor who has never met uv should still be able
// to run the tests.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pythonRoot = join(root, 'python');
const venv = join(pythonRoot, '.venv');
const venvBin = process.platform === 'win32' ? join(venv, 'Scripts') : join(venv, 'bin');
const venvPython = join(venvBin, process.platform === 'win32' ? 'python.exe' : 'python');

const PACKAGES = ['rhapsode-worker', 'rhapsode-engine-tone', 'conformance'];

// Engine adapters are installed WITHOUT their engines. In production each one gets its own
// virtualenv, which is the whole point of the design; here we want the adapter's own logic under
// test without pulling torch and several gigabytes of weights into a shared dev environment. The
// tests stub the model, which is the only part that needs any of that.
const ADAPTERS = ['rhapsode-engine-chatterbox', 'rhapsode-engine-kokoro', 'rhapsode-engine-orpheus', 'rhapsode-engine-dia'];
const DEV_DEPENDENCIES = ['pytest>=8', 'pytest-asyncio>=0.24', 'pytest-timeout>=2.3', 'httpx>=0.27', 'ruff>=0.6', 'mypy>=1.11', 'numpy>=1.26'];

// A sandbox or a corporate proxy that intercepts TLS makes pip's certificate check fail against a
// certificate pip has no way to trust. RHAPSODE_PIP_TRUSTED_HOSTS is the escape hatch for that
// machine, deliberately an environment variable rather than a checked-in pip.conf: weakening
// verification is a local decision and must not be the default anybody inherits by cloning.
const trustedHosts = (process.env.RHAPSODE_PIP_TRUSTED_HOSTS ?? '')
    .split(',')
    .map(host => host.trim())
    .filter(Boolean)
    .flatMap(host => ['--trusted-host', host]);

const has = command => spawnSync(command, ['--version'], { stdio: 'ignore' }).status === 0;

const run = (command, args, options = {}) => {
    const result = spawnSync(command, args, { stdio: 'inherit', cwd: root, ...options });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
};

const sync = () => {
    if (!existsSync(venvPython)) {
        console.log(`[python] creating ${venv}`);
        if (has('uv')) run('uv', ['venv', venv]);
        else run(process.env.PYTHON ?? 'python3', ['-m', 'venv', venv]);
    }
    const editable = PACKAGES.flatMap(name => ['-e', join(pythonRoot, name)]);
    console.log('[python] installing packages and dev dependencies');
    run(venvPython, ['-m', 'pip', 'install', '--quiet', '--upgrade', 'pip', ...trustedHosts]);
    run(venvPython, ['-m', 'pip', 'install', '--quiet', ...trustedHosts, ...editable, ...DEV_DEPENDENCIES]);
    run(venvPython, ['-m', 'pip', 'install', '--quiet', '--no-deps', ...trustedHosts, ...ADAPTERS.flatMap(name => ['-e', join(pythonRoot, name)])]);
};

const ensureSynced = () => {
    if (!existsSync(venvPython)) sync();
};

const commands = {
    sync,
    test: () => {
        ensureSynced();
        // One invocation per package, not one across all of them. Each package has its own
        // conftest, and pytest imports conftest by module name: pointed at several test directories
        // at once, the first `conftest` found shadows the rest and every other package's tests fail
        // to import their own helpers. Running per package also means each package's own pytest
        // configuration actually applies, which is what a contributor running it by hand would get.
        for (const name of [...PACKAGES, ...ADAPTERS]) {
            run(venvPython, ['-m', 'pytest', '-q'], { cwd: join(pythonRoot, name) });
        }
    },
    lint: () => {
        ensureSynced();
        run(venvPython, ['-m', 'ruff', 'check', pythonRoot]);
        run(venvPython, ['-m', 'ruff', 'format', '--check', pythonRoot]);
    },
    format: () => {
        ensureSynced();
        run(venvPython, ['-m', 'ruff', 'format', pythonRoot]);
        run(venvPython, ['-m', 'ruff', 'check', '--fix', pythonRoot]);
    },
    typecheck: () => {
        ensureSynced();
        for (const name of [...PACKAGES, ...ADAPTERS]) {
            run(venvPython, ['-m', 'mypy'], { cwd: join(pythonRoot, name) });
        }
    },
};

const command = process.argv[2];
if (!Object.hasOwn(commands, command)) {
    console.error(`usage: node scripts/python.mjs <${Object.keys(commands).join('|')}>`);
    process.exit(2);
}
commands[command]();
