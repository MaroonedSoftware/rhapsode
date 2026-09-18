import { existsSync } from 'node:fs';
import type { Check } from '@maroonedsoftware/johnny5';

import { loadCore } from '../lib/core.js';
import { configPath, venvPython } from '../lib/paths.js';
import { localEngines, readConfig } from '../lib/rhapsode.config.js';

/**
 * Every local engine's venv can import that engine's worker module: the exact command the server
 * will spawn, minus actually serving. The server finds this out as a worker that exits before its
 * handshake, restarts it with backoff, and after `maxRestarts` reports it `failed`; a broken venv
 * does not get better with backoff, so it is cheaper to hear about it here.
 */
export const engineVenvs: Check = {
    name: 'engine venvs',
    run: async ctx => {
        const read = readConfig(configPath(ctx.paths.repoRoot, ctx.env));
        if (read.status !== 'ok') return { ok: true, message: 'skipped: no readable config' };
        const engines = localEngines(read.config, ctx.paths.repoRoot);
        if (engines.length === 0) return { ok: true, message: 'no local engines configured' };

        const core = await loadCore();
        if (!core) return { ok: false, message: 'the core is not built, so the engine catalog is unavailable', fixHint: 'Run `pnpm build`.' };

        const problems: string[] = [];
        for (const engine of engines) {
            const module = read.config.engines?.[engine.id]?.module ?? core.CATALOG[engine.id]?.module;
            if (!module) {
                problems.push(`${engine.id} (not in the catalog and no \`module\` given)`);
                continue;
            }
            const python = venvPython(engine.venv);
            if (!existsSync(python)) {
                problems.push(`${engine.id} (no interpreter at ${python})`);
                continue;
            }
            try {
                await ctx.shell.run(python, ['-c', `import ${module}`]);
            } catch {
                problems.push(`${engine.id} (${module} does not import)`);
            }
        }
        if (problems.length > 0) return { ok: false, message: problems.join('; '), fixHint: 'Install each engine into the venv its entry names.' };
        return { ok: true, message: engines.map(engine => engine.id).join(', ') };
    },
};
