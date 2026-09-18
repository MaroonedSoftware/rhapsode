import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

/** The newest modification time of any file under `dir` ending in `extension`, or zero when there is none. */
export const newestMtime = (dir: string, extension: string): number => {
    if (!existsSync(dir)) return 0;
    let newest = 0;
    const walk = (current: string): void => {
        for (const entry of readdirSync(current, { withFileTypes: true })) {
            const full = resolve(current, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith(extension)) newest = Math.max(newest, statSync(full).mtimeMs);
        }
    };
    walk(dir);
    return newest;
};
