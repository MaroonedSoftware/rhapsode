import { createServer } from 'node:net';
import type { Check } from '@maroonedsoftware/johnny5';

import { loadCore } from '../lib/core.js';
import { configPath } from '../lib/paths.js';
import { readConfig } from '../lib/rhapsode.config.js';

const probe = (port: number): Promise<boolean> =>
    new Promise(done => {
        const server = createServer();
        server.once('error', () => done(false));
        server.once('listening', () => server.close(() => done(true)));
        server.listen(port);
    });

/**
 * The port the server would listen on is free. johnny5's `portsFree` takes a fixed list, and this
 * port comes out of the config file, so it is probed here instead.
 */
export const portFree: Check = {
    name: 'server port free',
    run: async ctx => {
        const read = readConfig(configPath(ctx.paths.repoRoot, ctx.env));
        const port = (read.status === 'ok' ? read.config.server?.port : undefined) ?? (await loadCore())?.DEFAULTS.port;
        if (port === undefined) return { ok: true, message: 'skipped: no port configured and the core is not built' };
        if (await probe(port)) return { ok: true, message: `:${port}` };
        return { ok: false, message: `:${port} is in use`, fixHint: `Stop what holds it (\`lsof -i :${port}\`), or set server.port.` };
    },
};
