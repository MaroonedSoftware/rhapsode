import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Check } from '@maroonedsoftware/johnny5';

import { newestMtime } from '../lib/mtime.js';

/** The workspace packages the server is built from, in dependency order. */
export const BUILT_PACKAGES = ['packages/contract', 'packages/core', 'apps/server'];

/**
 * Every package the server runs from has a `dist/` at least as new as its `src/`. Timestamps, not
 * contents: a cheap first answer. The failure it catches is running `node apps/server/dist/main.js`
 * after a pull and getting yesterday's core, which fails in ways that look like a bug in today's.
 */
export const buildCurrent: Check = {
    name: 'build current',
    run: async ctx => {
        const stale: string[] = [];
        for (const pkg of BUILT_PACKAGES) {
            const dist = resolve(ctx.paths.repoRoot, pkg, 'dist');
            if (!existsSync(dist)) return { ok: false, message: `${pkg} is not built`, fixHint: 'Run `pnpm build`.' };
            // Against the newest file rather than the directory: tsup overwrites in place, which
            // leaves a directory's own mtime where the first build put it.
            if (newestMtime(resolve(ctx.paths.repoRoot, pkg, 'src'), '.ts') > newestMtime(dist, '.js')) stale.push(pkg);
        }
        if (stale.length > 0) return { ok: false, message: `older than its source: ${stale.join(', ')}`, fixHint: 'Run `pnpm build`.' };
        return { ok: true, message: `${BUILT_PACKAGES.length} packages built` };
    },
    autoFix: async ctx => {
        const exit = await ctx.shell.runStreaming('pnpm', ['build'], { cwd: ctx.paths.repoRoot });
        return exit === 0 ? { ok: true, message: 'built' } : { ok: false, message: `pnpm build exited ${exit}` };
    },
};
