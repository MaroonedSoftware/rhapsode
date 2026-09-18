/**
 * The dev supervisor, in place of `node --watch`. Signet's and deadair's, pointed at this repo.
 *
 * `--watch` restarts on every individual file event, so a save-all, a `pnpm codegen` or a branch
 * switch costs one boot per file, and it starts the replacement before the old process has finished
 * tearing down. For this server that means two cores briefly holding the port and both spawning
 * workers into the same socket directory. This collects changes and acts once the writes stop
 * (`DEV_WATCH_DEBOUNCE_MS`), and does not start the successor until the predecessor has exited, so
 * every worker it spawned is drained first.
 *
 * It runs `src/main.ts` from source under swc, with the `development` export condition, which
 * `@rhapsode/core` and `@rhapsode/contract` map to their own `src/`. So an edit to the core takes
 * effect on the next restart with no build, and the watch covers all three packages.
 *
 * Deliberately plain JS: it supervises the swc register hook rather than running under it.
 */
import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(app, '../..');

/** How long the writes have to stop for before a restart is worth paying for. */
const DEBOUNCE_MS = Number(process.env.DEV_WATCH_DEBOUNCE_MS ?? 400);
/**
 * How long a graceful SIGTERM gets before SIGKILL. Longer than signet's, because the core drains its
 * workers on the way out and a worker mid-synthesis gets `workers.drainGraceMs` (10s by default).
 */
const KILL_AFTER_MS = Number(process.env.DEV_WATCH_KILL_AFTER_MS ?? 15000);

const NODE_ARGS = [
    '--no-warnings',
    '--conditions=development',
    '--import',
    '@swc-node/register/esm-register',
    '--enable-source-maps',
    './src/main.ts',
];

/** The config the README and the wizard use: the repository root's, unless one was named. */
const CONFIG = process.env.RHAPSODE_CONFIG ?? join(repo, 'rhapsode.config.json');

const WATCHED_DIRS = ['apps/server/src', 'packages/core/src', 'packages/contract/src'];
const WATCHED = /\.(ts|mts|cts|js|mjs|cjs|json)$/;

/** @type {import('node:child_process').ChildProcess | undefined} */
let child;
/** @type {NodeJS.Timeout | undefined} */
let timer;
let restarting = false;
let shuttingDown = false;

function log(message) {
    process.stdout.write(`[dev] ${message}\n`);
}

function start() {
    child = spawn(process.execPath, NODE_ARGS, {
        cwd: app,
        stdio: 'inherit',
        env: { ...process.env, RHAPSODE_CONFIG: CONFIG },
    });

    const started = child;
    child.on('exit', (code, signal) => {
        if (started !== child) return;
        child = undefined;
        if (shuttingDown || restarting) return;
        // A crash or a failed boot: wait for the edit that fixes it rather than looping on the same
        // stack trace, which is what `--watch` does too.
        log(`exited (${signal ?? code}); waiting for a change`);
    });
}

/** SIGTERM, then wait, with SIGKILL as the backstop for a shutdown hook that will not return. */
function stop() {
    const dying = child;
    if (!dying) return Promise.resolve();
    child = undefined;
    return new Promise(done => {
        const hammer = setTimeout(() => dying.kill('SIGKILL'), KILL_AFTER_MS);
        dying.on('exit', () => {
            clearTimeout(hammer);
            done();
        });
        dying.kill('SIGTERM');
    });
}

async function restart(reason) {
    if (restarting) return;
    restarting = true;
    log(`restarting (${reason})`);
    await stop();
    restarting = false;
    if (!shuttingDown) start();
}

/** @type {Set<string>} */
const pending = new Set();

function onChange(file) {
    pending.add(file);
    clearTimeout(timer);
    timer = setTimeout(() => {
        const count = pending.size;
        const first = [...pending][0];
        pending.clear();
        void restart(count === 1 ? first : `${count} files`);
    }, DEBOUNCE_MS);
}

for (const dir of WATCHED_DIRS) {
    const watcher = watch(join(repo, dir), { recursive: true }, (_event, filename) => {
        const name = filename ? String(filename) : dir;
        if (!WATCHED.test(name)) return;
        onChange(`${dir}/${name}`);
    });
    // A watcher that dies must not take the server down with it and leave an orphan holding the
    // port. Losing the watch costs a manual restart and nothing else.
    watcher.on('error', error => log(`watch on ${dir} failed (${error.code ?? error.message}); restart by hand`));
}

// The config file too, so an edit to it is picked up the way an edit to the code is.
try {
    watch(CONFIG, () => onChange('rhapsode.config.json')).on('error', () => {});
} catch (error) {
    // No config yet is an ordinary first run: the server starts with no engines, as it always has.
    if (error.code !== 'ENOENT') throw error;
}

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, async () => {
        shuttingDown = true;
        clearTimeout(timer);
        await stop();
        process.exit(0);
    });
}

log(`watching ${WATCHED_DIRS.join(', ')} (debounce ${DEBOUNCE_MS}ms), config ${CONFIG}`);
start();
