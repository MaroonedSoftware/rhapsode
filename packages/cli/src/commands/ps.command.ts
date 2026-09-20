import type { CommandModule } from '@maroonedsoftware/johnny5';

import { loadCore } from '../lib/core.js';
import { configPath, SERVER_ENTRY } from '../lib/paths.js';
import { table } from '../lib/residency.format.js';
import { readConfig } from '../lib/rhapsode.config.js';

type Client = typeof import('../lib/management.client.js');

interface PsOptions {
    server?: string;
    token?: string;
}

/**
 * `pnpm wizard ps`: what is on the card, and when each of it goes.
 *
 * A client of `GET /residency` and nothing more, so it can say nothing the API does not. It starts
 * no worker to answer, which is the property that route is built on: listing what is loaded should
 * not be a reason to load anything.
 */
const command: CommandModule<PsOptions> = {
    description: 'Show the models this server has loaded, their size and when they expire',
    options: [
        { flags: '--server <url>', description: 'The server to ask. Default: 127.0.0.1 on the configured port', envVar: 'RHAPSODE_SERVER' },
        { flags: '--token <token>', description: 'management.token, for a server on another machine', envVar: 'RHAPSODE_MANAGEMENT_TOKEN' },
    ],
    run: async (opts, ctx) => {
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
            const residency = await api.residency();

            if (residency.models.length === 0) {
                ctx.logger.info(`Nothing is loaded. The budget is ${residency.max} model${residency.max === 1 ? '' : 's'}.`);
            } else {
                for (const line of table(residency.models)) ctx.logger.info(line);
                ctx.logger.info(`${residency.resident} of ${residency.max} resident.`);
            }

            // A wait at maxResidentModels 1 looks exactly like a hang, and this is what says it is
            // not one. Worth printing even when the table above is empty.
            if (residency.waiting > 0) {
                ctx.logger.warn(
                    `${residency.waiting} request(s) waiting for a slot${residency.blockedBy === undefined ? '' : `, behind ${residency.blockedBy}`}.`,
                );
            }
            return 0;
        } catch (error) {
            if (error instanceof client.ServerUnreachable) {
                ctx.logger.error(`${error.message}. Start the server with \`node ${SERVER_ENTRY}\` and run this again.`);
            } else {
                ctx.logger.error((error as Error).message);
            }
            return 1;
        }
    },
};

export default command;
