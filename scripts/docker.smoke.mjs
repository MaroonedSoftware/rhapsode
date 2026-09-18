#!/usr/bin/env node
// Build both images, start them, install tone through the page's proxy, speak, then throw the
// containers away and start new ones on the same volumes. docs/operating.md § Docker.
//
// The last step is the point. Everything before it would pass with no volumes at all, and an image
// that put an engine anywhere outside /config and /data would pass it too, until its first upgrade.
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
const page = `http://127.0.0.1:${env.RHAPSODE_WEB_PORT}/api`;

function compose(...args) {
    const result = spawnSync('docker', ['compose', '--project-name', 'rhapsode-smoke', ...args], { cwd: root, env, stdio: 'inherit' });
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

let failed = false;
try {
    compose('up', '--build', '--detach', '--wait');

    const direct = await fetch(`${api}/engines/tone/install`, { method: 'POST' });
    check(direct.status === 403, 'the published API port refuses an install without the token');

    const started = await fetch(`${page}/engines/tone/install`, { method: 'POST' });
    check(started.ok, 'the page proxy starts an install');
    const { id } = await started.json();

    let job;
    for (let attempt = 0; attempt < 120; attempt += 1) {
        job = await (await fetch(`${page}/installs/${id}`)).json();
        if (job.state !== 'queued' && job.state !== 'running') break;
        await sleep(1000);
    }
    check(job.state === 'succeeded', `the install finished as ${job.state}`);
    check(await speak(), 'tone speaks');

    compose('down');
    compose('up', '--detach', '--wait');
    check((await installedEngines()).includes('tone'), 'tone is still installed in new containers');
    check(await speak(), 'tone speaks in new containers, from the virtualenv in the volume');
} catch (error) {
    failed = true;
    console.error(`failed: ${error.message}${error.cause ? ` (${error.cause.message ?? error.cause})` : ''}`);
    compose('logs', '--no-color', '--tail', '100');
} finally {
    if (process.env.KEEP !== '1') compose('down', '--volumes');
}
process.exit(failed ? 1 : 0);
