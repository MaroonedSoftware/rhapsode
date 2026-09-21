import type { CliContext } from '@maroonedsoftware/johnny5';

import { loadCore } from './core.js';
import type { ManagementClient } from './management.client.js';
import { configPath } from './paths.js';
import { readConfig } from './rhapsode.config.js';

type Client = typeof import('./management.client.js');

/** The running server this checkout's config points at, or the one `--server` names. */
export async function serverApi(ctx: CliContext, opts: { server?: string; token?: string }, client: Client): Promise<ManagementClient> {
    const read = readConfig(configPath(ctx.paths.repoRoot, ctx.env));
    const port = (read.status === 'ok' ? read.config.server?.port : undefined) ?? (await loadCore())?.DEFAULTS.port ?? 8080;
    return new client.ManagementClient(client.serverBase(port, opts.server), opts.token);
}
