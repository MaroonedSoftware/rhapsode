#!/usr/bin/env node
import { createCliApp, type CommandModule } from '@maroonedsoftware/johnny5';
import { nodeVersion } from '@maroonedsoftware/johnny5/versions';

import { buildCurrent } from './checks/build.current.js';
import { configFile } from './checks/config.file.js';
import { engineVenvs } from './checks/engine.venvs.js';
import { ffmpeg } from './checks/ffmpeg.js';
import { pnpmVersion } from './checks/pnpm.version.js';
import { portFree } from './checks/port.free.js';
import { pythonVenv } from './checks/python.venv.js';
import { pythonVersion } from './checks/python.version.js';
import installCommand from './commands/install.command.js';
import psCommand from './commands/ps.command.js';
import setupCommand from './commands/setup.command.js';
import unloadCommand from './commands/unload.command.js';

const app = await createCliApp({
    name: 'wizard',
    description: 'rhapsode developer CLI: first-run setup, a doctor for this checkout, engine installs, and what is on the card',
    version: '0.0.0',
    commands: [
        { path: ['setup'], module: setupCommand },
        { path: ['install'], module: installCommand as CommandModule },
        { path: ['ps'], module: psCommand as CommandModule },
        { path: ['unload'], module: unloadCommand as CommandModule },
    ],
    // In the order a fresh checkout has to satisfy them, so the first red line is the one to fix.
    checks: [nodeVersion({ min: 22 }), pnpmVersion, pythonVersion, pythonVenv, buildCurrent, configFile, engineVenvs, portFree, ffmpeg],
});

process.exit(await app.run(process.argv));
