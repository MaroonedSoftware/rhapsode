import type { CommandModule } from '@maroonedsoftware/johnny5';

import { loadCore } from '../lib/core.js';
import { configPath, SERVER_ENTRY } from '../lib/paths.js';
import { readConfig } from '../lib/rhapsode.config.js';

type Client = typeof import('../lib/management.client.js');

interface UnloadOptions {
    server?: string;
    token?: string;
    keepProcess?: boolean;
}

/**
 * `pnpm wizard unload <engine>`: give the memory back now.
 *
 * Terminates by default, because an unload leaves roughly 30% of the card behind (protocol.md § 3)
 * and somebody at a terminal asking for memory back means all of it. `--keep-process` is the soft
 * verb, for trading that 30% against a faster next load.
 */
const command: CommandModule<UnloadOptions> = {
    description: 'Free an engine’s model now, rather than waiting out its keep-alive',
    args: [{ name: 'engine', description: 'An installed engine id, such as kokoro', required: true }],
    options: [
        { flags: '--server <url>', description: 'The server to ask. Default: 127.0.0.1 on the configured port', envVar: 'RHAPSODE_SERVER' },
        { flags: '--token <token>', description: 'management.token, for a server on another machine', envVar: 'RHAPSODE_MANAGEMENT_TOKEN' },
        {
            flags: '--keep-process',
            description: 'Unload the weights but leave the worker running. Faster to load again, and keeps ~30% of the card',
            type: 'boolean',
        },
    ],
    run: async (opts, ctx, args) => {
        const engine = args[0];
        if (engine === undefined) {
            ctx.logger.error('name an engine: `pnpm wizard unload kokoro`');
            return 1;
        }

        let client: Client;
        try {
            client = await import('../lib/management.client.js');
        } catch {
            ctx.logger.error('the packages are not built. Run `pnpm build`, start the server, and try again.');
            return 1;
        }

        const read = readConfig(configPath(ctx.paths.repoRoot, ctx.env));
        const port = (read.status === 'ok' ? read.config.server?.port : undefined) ?? (await loadCore())?.DEFAULTS.port ?? 8080;
        const api = new client.ManagementClient(client.serverBase(port, opts.server), opts.token);

        try {
            const summary = await api.unload(engine, opts.keepProcess === true ? 'unload' : 'terminate');
            ctx.logger.success(
                opts.keepProcess === true
                    ? `${summary.displayName} unloaded its weights; the worker is still ${summary.process}.`
                    : `${summary.displayName} let its card go.`,
            );
            return 0;
        } catch (error) {
            if (error instanceof client.ServerUnreachable) {
                ctx.logger.error(`${error.message}. Start the server with \`node ${SERVER_ENTRY}\` and run this again.`);
            } else if (error instanceof client.ManagementError && error.code === 'conflict') {
                // Not a failure to fix, a state to wait out: cutting off a stream in progress hands
                // that caller a truncated file for something they could not have predicted.
                ctx.logger.warn(`${error.message}`);
            } else if (error instanceof client.ManagementError && error.code === 'forbidden') {
                ctx.logger.error(`${error.message}. From another machine, pass --token with the server's management.token.`);
            } else {
                ctx.logger.error((error as Error).message);
            }
            return 1;
        }
    },
};

export default command;
