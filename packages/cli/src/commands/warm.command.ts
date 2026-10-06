import { wizard, type CliContext, type CommandModule } from '@maroonedsoftware/johnny5';

import { interactiveUi, plainUi, reportFailure, type Ui } from '../lib/job.ui.js';
import { serverApi } from '../lib/server.api.js';
import { unwarmed, WARM_COST, warmEach } from '../lib/warm.js';

type Client = typeof import('../lib/management.client.js');

interface WarmOptions {
    server?: string;
    token?: string;
    yes?: boolean;
}

/**
 * `pnpm wizard warm <engine> [variant]`: compile now what would compile on a first request. § 10.
 *
 * Named, it warms that variant. Left out, it warms every variant the engine says compiles that the
 * core has not recorded as warmed, which is what an engine installed before installs warmed needs:
 * Orpheus `full`'s first load is 35 s against 12 from the cache.
 */
const command: CommandModule<WarmOptions> = {
    description: 'Load a variant that compiles on its first load once, so its first request does not',
    args: [
        { name: 'engine', description: 'An installed engine id, such as orpheus', required: true },
        { name: 'variant', description: 'The variant to warm. Default: every one that compiles and has not been warmed', required: false },
    ],
    options: [
        { flags: '--server <url>', description: 'The server to ask. Default: 127.0.0.1 on the configured port', envVar: 'RHAPSODE_SERVER' },
        { flags: '--token <token>', description: 'management.token, for a server on another machine', envVar: 'RHAPSODE_MANAGEMENT_TOKEN' },
        { flags: '-y, --yes', description: 'Warm without asking', type: 'boolean' },
    ],
    run: async (opts, ctx, args) => {
        let client: Client;
        try {
            client = await import('../lib/management.client.js');
        } catch {
            ctx.logger.error('the packages are not built. Run `pnpm build`, start the server, and try again.');
            return 1;
        }

        const [engine, variant] = args as [string, string | undefined];
        if (ctx.isInteractive()) {
            return wizard(ctx, { title: `rhapsode warm ${engine}` }, async w =>
                warm(engine, variant, opts, ctx, client, interactiveUi(w, opts.yes === true)),
            );
        }
        return warm(engine, variant, opts, ctx, client, plainUi(ctx, opts.yes === true));
    },
};

async function warm(engine: string, variant: string | undefined, opts: WarmOptions, ctx: CliContext, client: Client, ui: Ui): Promise<number> {
    const api = await serverApi(ctx, opts, client);
    try {
        const entry = (await api.catalog()).find(candidate => candidate.id === engine);
        if (entry === undefined || entry.installed !== 'yes') {
            ui.error(`"${engine}" is not installed here. \`pnpm wizard install ${engine}\` installs it.`);
            return 1;
        }

        const variants = variant === undefined ? unwarmed(entry, await api.capabilities(engine)) : [variant];
        if (variants.length === 0) {
            ui.success(`Nothing to warm: no variant of ${entry.displayName} compiles on its first load that has not been warmed.`);
            return 0;
        }
        // Only a person is asked, as for a reinstall: a script that named the engine has decided.
        if (ctx.isInteractive() && !(await ui.confirm(`Warm ${entry.displayName} ${variants.join(', ')}? ${capitalise(WARM_COST)}.`, true))) {
            ui.warn('Not warmed.');
            return 1;
        }
        return await warmEach(api, ui, entry, variants);
    } catch (error) {
        reportFailure(error, client, ui);
        return 1;
    }
}

const capitalise = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

export default command;
