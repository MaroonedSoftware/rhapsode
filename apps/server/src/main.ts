#!/usr/bin/env node
/**
 * The composition root. It reads configuration, builds the server and starts it, and owns nothing
 * else: every decision that matters lives in `@rhapsode/core`, which is a library so that the
 * shims can be built on it later without going through a process.
 */

import { readFile } from 'node:fs/promises';

import { buildServer, DEFAULTS, type RhapsodeConfig } from '@rhapsode/core';

const configPath = process.env.RHAPSODE_CONFIG ?? './rhapsode.config.json';

const settings: RhapsodeConfig = await readFile(configPath, 'utf8')
    .then(text => JSON.parse(text) as RhapsodeConfig)
    .catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return {};
        throw new Error(`could not read ${configPath}: ${error.message}`, { cause: error });
    });

const builder = await buildServer(settings);

await builder.start(settings.server?.port ?? DEFAULTS.port, {
    // Comfortably longer than a worker's own drain grace, because every module's shutdown hook is
    // awaited before the process exits. Equal values make a correct shutdown look hung.
    shutdownGraceMs: settings.server?.shutdownGraceMs ?? DEFAULTS.shutdownGraceMs,
});
