#!/usr/bin/env node
/**
 * The composition root. It reads configuration, builds the server and starts it, and owns nothing
 * else: every decision that matters lives in `@rhapsode/core`, which is a library so that the
 * shims can be built on it later without going through a process.
 */

import { resolve } from 'node:path';

import { buildServer, DEFAULTS, loadSettings } from '@rhapsode/core';

const configPath = resolve(process.env.RHAPSODE_CONFIG ?? './rhapsode.config.json');

// The operator's file with the engines this server installed underneath it. protocol.md § 10.
const { settings, managed } = await loadSettings(configPath);

const builder = await buildServer(settings, undefined, managed);

await builder.start(settings.server?.port ?? DEFAULTS.port, {
    // Comfortably longer than a worker's own drain grace, because every module's shutdown hook is
    // awaited before the process exits. Equal values make a correct shutdown look hung.
    shutdownGraceMs: settings.server?.shutdownGraceMs ?? DEFAULTS.shutdownGraceMs,
});
