import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Check } from '@maroonedsoftware/johnny5';

import { loadCore } from '../lib/core.js';
import { configPath, displayPath, VENV } from '../lib/paths.js';
import { readConfig, renderConfig, starterConfig } from '../lib/rhapsode.config.js';

/**
 * The config file exists, parses, and names at least one engine. The server starts without one and
 * reports no engines, which is healthy-looking and useless, so the doctor is the one that says so.
 */
export const configFile: Check = {
    name: 'config file',
    run: async ctx => {
        const path = configPath(ctx.paths.repoRoot, ctx.env);
        const shown = displayPath(ctx.paths.repoRoot, path);
        const read = readConfig(path);
        if (read.status === 'missing') {
            return { ok: false, message: `${shown} not found; the server would start with no engines`, fixHint: 'Run `pnpm wizard setup`.' };
        }
        if (read.status === 'invalid') return { ok: false, message: `${shown}: ${read.error}` };
        const engines = Object.keys(read.config.engines ?? {});
        if (engines.length === 0)
            return { ok: false, message: `${shown} names no engines`, fixHint: 'Add one under `engines`; see docs/operating.md.' };
        return { ok: true, message: `${shown}: ${engines.join(', ')}` };
    },
    autoFix: async ctx => {
        const path = configPath(ctx.paths.repoRoot, ctx.env);
        if (readConfig(path).status !== 'missing') return { ok: false, message: 'the file exists; fix it by hand rather than have it overwritten' };
        const core = await loadCore();
        if (!core) return { ok: false, message: 'the core is not built, so its default port is unknown', fixHint: 'Run `pnpm build` first.' };
        writeFileSync(path, renderConfig(starterConfig(core.DEFAULTS.port, resolve(ctx.paths.repoRoot, VENV))));
        return { ok: true, message: `wrote ${displayPath(ctx.paths.repoRoot, path)} with the tone engine` };
    },
};
