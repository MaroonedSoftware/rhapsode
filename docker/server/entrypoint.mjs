/**
 * What the container does before the server starts, and then the server.
 *
 * The config lives in the /config volume, so it outlives the image, and on first boot there is none.
 * This writes one that works in the image, and never touches it again: from then on the file is the
 * operator's, as docs/operating.md promises of the config everywhere else.
 *
 * It also leaves the management token where the web container can read it. docs/operating.md § Docker.
 */

import { randomBytes } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { loadSettings } from '@rhapsode/core';

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

await import('./dist/main.js');
