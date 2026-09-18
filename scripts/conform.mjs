#!/usr/bin/env node
// Start the reference engine, run the conformance suite against it, stop it.
//
// Separate from `pnpm test` on purpose: this is the command an engine author runs against their own
// worker, so it has to work standing on its own, and running it here is how we find out that it
// does.

import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const venvBin = join(root, 'python/.venv', process.platform === 'win32' ? 'Scripts' : 'bin');
const python = join(venvBin, process.platform === 'win32' ? 'python.exe' : 'python');

const worker = spawn(python, ['-m', 'rhapsode_engine_tone'], {
    cwd: root,
    env: {
        ...process.env,
        RHAPSODE_WORKER_LISTEN: 'tcp:127.0.0.1:0',
        RHAPSODE_WORKER_ENGINE: 'tone',
        RHAPSODE_WORKER_CONTRACT: '1',
    },
    stdio: ['ignore', 'pipe', 'inherit'],
});

// The single line on stdout, which is also the only thing telling us the port the OS chose.
const handshake = await new Promise((fulfil, fail) => {
    const lines = createInterface({ input: worker.stdout });
    const timer = setTimeout(() => fail(new Error('no handshake within 60s')), 60_000).unref();
    lines.once('line', line => {
        clearTimeout(timer);
        lines.close();
        fulfil(JSON.parse(line));
    });
    worker.once('exit', code => fail(new Error(`the worker exited ${code} before the handshake`)));
});

console.log(`conformance: ${handshake.listen}`);
const result = spawnSync(join(venvBin, 'rhapsode-conform'), [handshake.listen, '--no-colour'], { stdio: 'inherit' });

worker.kill('SIGTERM');
process.exit(result.status ?? 1);
