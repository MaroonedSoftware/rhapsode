import { wizard, type CliContext, type CommandModule } from '@maroonedsoftware/johnny5';
import type { UpdateStatus } from '@rhapsode/contract';
import { DateTime } from 'luxon';

import { interactiveUi, plainUi, reportFailure, type Ui } from '../lib/job.ui.js';
import type { ManagementClient } from '../lib/management.client.js';
import { REINSTALL_COST, reinstallAll } from '../lib/reinstall.js';
import { serverApi } from '../lib/server.api.js';

type Client = typeof import('../lib/management.client.js');

interface UpdateOptions {
    server?: string;
    token?: string;
    exitCode?: boolean;
    yes?: boolean;
}

/** How long to wait for the core's first answer from GitHub, which it asks for on the first read. */
const PENDING_WAIT_SECONDS = 10;

/** Exit status for `--exit-code` when anything is behind, distinct from 1, which is a failure. */
const BEHIND = 2;

/**
 * `pnpm wizard update`: is anything behind, and what to do about it. § 9.
 *
 * The core cannot replace its own image, so for rhapsode itself this says which release is out and
 * the commands that install it. For engines an upgrade left behind it offers the reinstall, which
 * the core can do. `--exit-code` only reports, for a cron line or a monitor that wants a status.
 */
const command: CommandModule<UpdateOptions> = {
    description: 'Say whether a newer rhapsode is out or an engine is behind, and reinstall engines that are',
    args: [],
    options: [
        { flags: '--server <url>', description: 'The server to ask. Default: 127.0.0.1 on the configured port', envVar: 'RHAPSODE_SERVER' },
        { flags: '--token <token>', description: 'management.token, for a server on another machine', envVar: 'RHAPSODE_MANAGEMENT_TOKEN' },
        { flags: '--exit-code', description: `Change nothing, and exit ${BEHIND} when anything is behind`, type: 'boolean' },
        { flags: '-y, --yes', description: 'Reinstall engines that are behind without asking', type: 'boolean' },
    ],
    run: async (opts, ctx) => {
        let client: Client;
        try {
            client = await import('../lib/management.client.js');
        } catch {
            ctx.logger.error('the packages are not built. Run `pnpm build`, start the server, and try again.');
            return 1;
        }

        if (ctx.isInteractive())
            return wizard(ctx, { title: 'rhapsode update' }, async w => update(opts, ctx, client, interactiveUi(w, opts.yes === true)));
        return update(opts, ctx, client, plainUi(ctx, opts.yes === true));
    },
};

async function update(opts: UpdateOptions, ctx: CliContext, client: Client, ui: Ui): Promise<number> {
    const api = await serverApi(ctx, opts, client);
    try {
        const status = await answered(api);
        describeRelease(status, ui);

        const behind = (await api.engines()).filter(engine => engine.outdated === true);
        if (behind.length > 0) {
            ui.warn(`Installed by an earlier release: ${behind.map(engine => `${engine.id} ${engine.workerVersion ?? ''}`.trim()).join(', ')}.`);
        } else {
            ui.info('Every engine is on this core’s version.');
        }

        if (opts.exitCode === true) return status.updateAvailable === true || behind.length > 0 ? BEHIND : 0;
        if (behind.length === 0) return 0;
        if (!(await ui.confirm(`Reinstall them now? For each, ${REINSTALL_COST}.`, true))) {
            ui.info('Run `pnpm wizard reinstall --all` when you are ready.');
            return 0;
        }
        return await reinstallAll(api, ui);
    } catch (error) {
        reportFailure(error, client, ui);
        return 1;
    }
}

/** The core's answer, waiting briefly on the first check after boot, which this read is what starts. */
async function answered(api: ManagementClient): Promise<UpdateStatus> {
    const giveUp = DateTime.utc().plus({ seconds: PENDING_WAIT_SECONDS });
    let status = await api.updateStatus();
    while (status.check === 'pending' && DateTime.utc() < giveUp) {
        await new Promise(fulfil => setTimeout(fulfil, 500));
        status = await api.updateStatus();
    }
    return status;
}

function describeRelease(status: UpdateStatus, ui: Ui): void {
    switch (status.check) {
        case 'off':
            ui.info(`rhapsode ${status.version}. The update check is off (update.check, or RHAPSODE_UPDATE_CHECK).`);
            return;
        case 'pending':
            ui.info(`rhapsode ${status.version}. GitHub has not answered yet; try again in a moment.`);
            return;
        case 'failed':
            ui.warn(`rhapsode ${status.version}. The server could not reach GitHub to ask for the latest release.`);
            return;
        case 'ok':
            if (status.updateAvailable !== true) {
                ui.success(`rhapsode ${status.version}, the latest release.`);
                return;
            }
            ui.warn(`rhapsode ${status.version}. ${status.latest} is out${status.releaseUrl === undefined ? '' : `: ${status.releaseUrl}`}`);
            ui.info(
                status.distribution === 'docker'
                    ? `Beside compose.yaml: \`docker compose pull && docker compose up -d\`, after setting RHAPSODE_VERSION to ${status.latest} if your compose pins it. Then run this again for the engines.`
                    : `Check out v${status.latest}, then \`pnpm install && pnpm build\`, restart the server, and run this again for the engines.`,
            );
    }
}

export default command;
