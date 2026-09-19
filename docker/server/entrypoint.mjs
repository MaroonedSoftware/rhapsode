/**
 * What the container does before the server starts, and then the server.
 *
 * The config lives in the /config volume, so it outlives the image, and on first boot there is none.
 * This writes one that works in the image, and never touches it again: from then on the file is the
 * operator's, as docs/operating.md promises of the config everywhere else.
 *
 * Then it starts nginx beside the server, serving the page and proxying /api to the core with the
 * management token. The token is also left where a separate web container can read it, for anyone
 * still running one. docs/operating.md § Docker.
 */

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { DEFAULTS, loadSettings } from '@rhapsode/core';

const configPath = process.env.RHAPSODE_CONFIG ?? '/config/rhapsode.config.json';
const tokenPath = join(dirname(configPath), 'management.token');

const seed = {
    install: {
        // rhapsode-worker is not on PyPI yet, so an install needs the sources, and they are in the
        // image rather than above the server's dist/ where the core would otherwise look for them.
        sourceDir: '/app/python',
        // A version, not a path, because there is no Python in the image. uv fetches one into the
        // /data volume beside the virtualenvs that use it. A virtualenv made from an interpreter in
        // the image would break on the next base image bump, and take several GB of torch with it.
        python: '3.12',
    },
    // Cloned voices are the one thing on /data that cannot be downloaded again, so they live in
    // /config with the rest of what is worth backing up.
    workers: { voiceDir: join(dirname(configPath), 'voices') },
    // The page has no sign-in and a published port is never loopback to the core, so the web
    // container presents this for it. Ports are published on 127.0.0.1 for the same reason.
    management: { token: randomBytes(32).toString('base64url') },
};

try {
    // `wx` fails when the file exists, which is the point: an operator's file is never overwritten,
    // and two containers racing on one volume cannot both write it.
    await writeFile(configPath, `${JSON.stringify(seed, undefined, 4)}\n`, { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ level: 'info', msg: `wrote a starting config to ${configPath}` }));
} catch (error) {
    if (error.code !== 'EEXIST') throw error;
}

// Read through the server's own loader, so the token the proxy presents is the one the server will
// accept, including after an operator edits it or removes it.
const { settings } = await loadSettings(configPath);
const token = settings.management?.token;
if (typeof token === 'string' && token !== '') await writeFile(tokenPath, token, { mode: 0o600 });
else await rm(tokenPath, { force: true });

// RFC 6750's b64token, which is every valid bearer token. Anything else would be pasted into
// nginx's config as it stands, where a `$` reads as a variable and a `"` ends the string.
const authorization = typeof token === 'string' && /^[A-Za-z0-9\-._~+/]+=*$/.test(token) ? `Bearer ${token}` : '';
if (typeof token === 'string' && token !== '' && authorization === '') {
    console.log(JSON.stringify({ level: 'warn', msg: 'management.token is not a valid bearer token, so the page cannot install' }));
}

const nginxDir = '/tmp/rhapsode-nginx';
await mkdir(nginxDir, { recursive: true });
const template = await readFile(new URL('./nginx.conf.template', import.meta.url), 'utf8');
const values = { RHAPSODE_API_PORT: String(settings.server?.port ?? DEFAULTS.port), RHAPSODE_AUTHORIZATION: authorization };
await writeFile(
    join(nginxDir, 'nginx.conf'),
    template.replace(/\$\{(RHAPSODE_[A-Z_]+)\}/g, (_, name) => values[name]),
);

// tini forwards a stop to this process alone, so nginx keeps serving while the server drains, and
// is stopped only once the server exits. Stopped first, a /speak through the page would be cut off
// mid-sentence by the proxy rather than finished by the core.
// `-e stderr` because nginx opens its compiled-in error log before reading the config, and as any
// user but root that is a permission error on every start.
const nginx = spawn('nginx', ['-c', join(nginxDir, 'nginx.conf'), '-e', 'stderr'], { stdio: 'inherit' });
let exiting = false;
process.once('exit', () => {
    exiting = true;
    nginx.kill('SIGQUIT');
});
// Docker restarts a container that exits, not one that is unhealthy, so a dead nginx would leave a
// running server nobody can install through. Stopping the server the way `docker stop` does lets it
// drain, and the restart policy brings both back.
nginx.once('exit', (code, signal) => {
    if (exiting) return;
    console.log(JSON.stringify({ level: 'error', msg: `nginx exited (${signal ?? code}), so the container is stopping` }));
    process.exitCode = 1;
    process.kill(process.pid, 'SIGTERM');
});

await import('./dist/main.js');
