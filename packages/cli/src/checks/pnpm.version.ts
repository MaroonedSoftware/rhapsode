import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Check } from '@maroonedsoftware/johnny5';

/** The version pinned in the root package.json `packageManager` field, ignoring any integrity suffix. */
const pinnedPnpm = (repoRoot: string): string | undefined => {
    const path = resolve(repoRoot, 'package.json');
    if (!existsSync(path)) return undefined;
    try {
        const pkg = JSON.parse(readFileSync(path, 'utf8')) as { packageManager?: string };
        return pkg.packageManager?.match(/^pnpm@(\d+\.\d+\.\d+)/)?.[1];
    } catch {
        return undefined;
    }
};

/** Whether `installed` is at least `floor`, compared numerically by major, minor and patch. */
export const atLeast = (installed: string, floor: string): boolean => {
    const a = installed.split('.').map(part => Number.parseInt(part, 10) || 0);
    const b = floor.split('.').map(part => Number.parseInt(part, 10) || 0);
    for (let i = 0; i < 3; i++) {
        const x = a[i] ?? 0;
        const y = b[i] ?? 0;
        if (x !== y) return x > y;
    }
    return true;
};

/**
 * pnpm is on PATH and at least the pinned version. A floor rather than johnny5's exact match, so a
 * newer pnpm passes as long as `packageManager` moves with it.
 */
export const pnpmVersion: Check = {
    name: 'pnpm version',
    run: async ctx => {
        let installed: string;
        try {
            installed = String((await ctx.shell.run('pnpm', ['--version'])).stdout).trim();
        } catch {
            return { ok: false, message: 'pnpm is not on PATH', fixHint: 'Install pnpm: https://pnpm.io/installation' };
        }
        const floor = pinnedPnpm(ctx.paths.repoRoot);
        if (!floor) return { ok: true, message: `pnpm ${installed}` };
        if (!atLeast(installed, floor)) {
            return { ok: false, message: `pnpm ${installed}; the repository pins ${floor}`, fixHint: `Run \`pnpm self-update ${floor}\`.` };
        }
        return { ok: true, message: `pnpm ${installed} (pinned ${floor})` };
    },
};
