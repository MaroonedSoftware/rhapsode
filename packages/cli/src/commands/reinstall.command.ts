import { wizard, type CliContext, type CommandModule } from '@maroonedsoftware/johnny5';

import { interactiveUi, plainUi, reportFailure, type Ui } from '../lib/job.ui.js';
import { REINSTALL_COST, reinstallAll, reinstallOne } from '../lib/reinstall.js';
import { serverApi } from '../lib/server.api.js';

type Client = typeof import('../lib/management.client.js');

interface ReinstallOptions {
    server?: string;
    token?: string;
    all?: boolean;
    yes?: boolean;
}

/**
 * `pnpm wizard reinstall <engine>` and `--all`: rebuild engines an upgrade left behind. § 10.
 *
 * The server builds the new virtualenv beside the old one and swaps it in, so the engine keeps
 * working while this runs and a failure changes nothing. `--all` is one request, the same one a cron
 * line makes with curl, so the wizard and the unattended box cannot disagree about which engines.
 */
const command: CommandModule<ReinstallOptions> = {
    description: 'Rebuild an installed engine at this core’s version, or every one an upgrade left behind',
    args: [{ name: 'engine', description: 'An installed engine id, such as kokoro. Leave it out with --all', required: false }],
    options: [
        { flags: '--all', description: 'Every engine this server installed whose worker is not this core’s version', type: 'boolean' },
        { flags: '--server <url>', description: 'The server to ask. Default: 127.0.0.1 on the configured port', envVar: 'RHAPSODE_SERVER' },
        { flags: '--token <token>', description: 'management.token, for a server on another machine', envVar: 'RHAPSODE_MANAGEMENT_TOKEN' },
        { flags: '-y, --yes', description: 'Answer yes, including to a weights licence, for a script', type: 'boolean' },
    ],
    run: async (opts, ctx, args) => {
        const engine = args[0];
        if ((engine === undefined) === (opts.all !== true)) {
            ctx.logger.error('name one engine, `pnpm wizard reinstall kokoro`, or pass --all');
            return 1;
        }

        let client: Client;
        try {
            client = await import('../lib/management.client.js');
        } catch {
            ctx.logger.error('the packages are not built. Run `pnpm build`, start the server, and try again.');
            return 1;
        }

        const title = engine === undefined ? 'rhapsode reinstall --all' : `rhapsode reinstall ${engine}`;
        if (ctx.isInteractive()) {
            return wizard(ctx, { title }, async w => reinstall(engine, opts, ctx, client, interactiveUi(w, opts.yes === true)));
        }
        return reinstall(engine, opts, ctx, client, plainUi(ctx, opts.yes === true));
    },
};

async function reinstall(engine: string | undefined, opts: ReinstallOptions, ctx: CliContext, client: Client, ui: Ui): Promise<number> {
    const api = await serverApi(ctx, opts, client);
    try {
        if (engine === undefined) return await reinstallAll(api, ui);

        const catalog = await api.catalog();
        const entry = catalog.find(candidate => candidate.id === engine);
        if (entry === undefined) {
            ui.error(`there is no engine "${engine}". The catalog has ${catalog.map(candidate => candidate.id).join(', ')}.`);
            return 1;
        }
        if (entry.installed !== 'yes') {
            ui.error(`${entry.displayName} is not installed. Install it with \`pnpm wizard install ${engine}\`.`);
            return 1;
        }
        if (!entry.managed) {
            ui.error(`${entry.displayName} is configured in the operator's config file, so rebuilding its virtualenv is theirs to do there.`);
            return 1;
        }
        if (entry.outdated === false) ui.info(`${entry.displayName} is already on this core's version; this rebuilds its virtualenv anyway.`);
        // Only a person is asked: a script that named the engine has decided, and the cost is not a
        // licence. The licence, where the server asks for one, still needs --yes.
        if (ctx.isInteractive() && !(await ui.confirm(`Reinstall ${entry.displayName}? ${capitalise(REINSTALL_COST)}.`, true))) {
            ui.warn('Not reinstalled.');
            return 1;
        }
        return await reinstallOne(api, client, ui, entry);
    } catch (error) {
        reportFailure(error, client, ui);
        return 1;
    }
}

const capitalise = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

export default command;
