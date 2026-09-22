#!/usr/bin/env node
// Build the image, start it, install tone through the page's proxy, speak, then throw the
// container away and start a new one on the same volumes, and finally make tone look like an
// engine an earlier release installed and reinstall it. docs/operating.md § Docker.
//
// The replacement is the point. Everything before it would pass with no volumes at all, and an
// image that put an engine anywhere outside /config and /data would pass it too, until its first
// upgrade. The reinstall is what an upgrade asks of the operator next, and it is the one step that
// moves a live engine to a new virtualenv inside the volume.
//
// Ports 18080 and 18081 by default, so that it runs beside `pnpm dev`. KEEP=1 leaves it running.

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = {
    ...process.env,
    RHAPSODE_API_PORT: process.env.RHAPSODE_API_PORT ?? '18080',
    RHAPSODE_WEB_PORT: process.env.RHAPSODE_WEB_PORT ?? '18081',
};
const api = `http://127.0.0.1:${env.RHAPSODE_API_PORT}`;
const site = `http://127.0.0.1:${env.RHAPSODE_WEB_PORT}`;
const page = `${site}/api`;

function compose(...args) {
    // compose.build.yaml, so this tests the checkout it runs in and never a published image.
    const result = spawnSync('docker', ['compose', '--project-name', 'rhapsode-smoke', '-f', 'compose.yaml', '-f', 'compose.build.yaml', ...args], {
        cwd: root,
        env,
        stdio: 'inherit',
    });
    if (result.status !== 0) throw new Error(`docker compose ${args.join(' ')} exited ${result.status}`);
}

function check(condition, message) {
    if (!condition) throw new Error(message);
    console.log(`ok: ${message}`);
}

async function speak() {
    const response = await fetch(`${api}/speak`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ engine: 'tone', text: 'Right, that was The Verve Pipe.', format: 'wav', stream: false }),
    });
    const body = Buffer.from(await response.arrayBuffer());
    return response.ok && body.subarray(0, 4).toString('latin1') === 'RIFF';
}

async function installedEngines() {
    const health = await (await fetch(`${api}/health`)).json();
    return health.engines.map(engine => engine.id);
}

async function engine(id) {
    const health = await (await fetch(`${api}/health`)).json();
    return { version: health.version, ...health.engines.find(candidate => candidate.id === id) };
}

/**
 * Wait for the published port, not just the container. After a `--force-recreate`, Docker Desktop
 * reported the container healthy, which is its check from inside, while the host's port forward was
 * still resetting connections: the first /health from the host failed with ECONNRESET twice in a row.
 */
async function reachable() {
    for (let attempt = 0; attempt < 30; attempt += 1) {
        try {
            if ((await fetch(`${api}/health`)).ok) return;
        } catch {
            // Not forwarded yet.
        }
        await sleep(1000);
    }
    throw new Error(`${api}/health never answered from the host`);
}

async function settled(id) {
    let job;
    for (let attempt = 0; attempt < 120; attempt += 1) {
        job = await (await fetch(`${page}/installs/${id}`)).json();
        if (job.state !== 'queued' && job.state !== 'running') break;
        await sleep(1000);
    }
    return job;
}

let failed = false;
try {
    compose('up', '--build', '--detach', '--wait');

    const index = await fetch(`${site}/try`);
    check(index.ok && (await index.text()).includes('<div id="root">'), 'the page is served, at its own routes as well as /');

    const direct = await fetch(`${api}/engines/tone/install`, { method: 'POST' });
    check(direct.status === 403, 'the published API port refuses an install without the token');

    const started = await fetch(`${page}/engines/tone/install`, { method: 'POST' });
    check(started.ok, 'the page proxy starts an install');
    const { id } = await started.json();

    const job = await settled(id);
    check(job.state === 'succeeded', `the install finished as ${job.state}`);
    check(await speak(), 'tone speaks');

    compose('down');
    compose('up', '--detach', '--wait');
    check((await installedEngines()).includes('tone'), 'tone is still installed in a new container');
    check(await speak(), 'tone speaks in a new container, from the virtualenv in the volume');

    const update = await (await fetch(`${api}/update`)).json();
    check(update.distribution === 'docker', `GET /update answers without waiting on GitHub, as ${update.check}, and knows it is the image`);

    // What an upgrade leaves: a worker in the volume from an earlier release. Renaming its metadata
    // is all that takes, because that is all `workerVersion` reads, and a new container is needed
    // because the core reads it once per engine rather than on every /health.
    compose(
        'exec',
        '-T',
        'server',
        'sh',
        '-c',
        'for d in /data/.rhapsode/venvs/tone/lib/python*/site-packages/rhapsode_worker-*.dist-info; do mv "$d" "$(dirname "$d")/rhapsode_worker-0.0.1.dist-info"; done',
    );
    compose('up', '--detach', '--wait', '--force-recreate');
    await reachable();
    const stale = await engine('tone');
    check(stale.outdated === true && stale.workerVersion === '0.0.1', `tone reads as behind core ${stale.version}`);

    const reinstall = await fetch(`${page}/installs/outdated`, { method: 'POST' });
    const answer = await reinstall.json();
    check(reinstall.status === 202 && answer.jobs.length === 1 && answer.skipped.length === 0, 'the page proxy reinstalls everything behind');
    const rebuilt = await settled(answer.jobs[0].id);
    check(rebuilt.state === 'succeeded', `the reinstall finished as ${rebuilt.state}`);
    check((await engine('tone')).outdated === false, 'tone is on the core’s version again');
    check(await speak(), 'tone speaks from the virtualenv the reinstall built');
    const again = await (await fetch(`${page}/installs/outdated`, { method: 'POST' })).json();
    check(again.jobs.length === 0 && again.skipped.length === 0, 'a second reinstall of everything has nothing to do');
} catch (error) {
    failed = true;
    console.error(`failed: ${error.message}${error.cause ? ` (${error.cause.message ?? error.cause})` : ''}`);
    compose('logs', '--no-color', '--tail', '100');
} finally {
    if (process.env.KEEP !== '1') compose('down', '--volumes');
}
process.exit(failed ? 1 : 0);
