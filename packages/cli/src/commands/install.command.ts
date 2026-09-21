import { wizard, type CliContext, type CommandModule } from '@maroonedsoftware/johnny5';

import { loadCore } from '../lib/core.js';
import { follow, interactiveUi, plainUi, reportFailure, type Ui } from '../lib/job.ui.js';
import { configPath } from '../lib/paths.js';
import { readConfig } from '../lib/rhapsode.config.js';

type Client = typeof import('../lib/management.client.js');

interface InstallOptions {
    server?: string;
    token?: string;
    pull?: boolean;
    yes?: boolean;
}

/**
 * `pnpm wizard install <engine>`: a client of the management API and nothing more.
 *
 * It asks the running server to do the install, the way a web page would, so that there is one
 * implementation of installing and two ways to ask for it. That is also why it needs the server
 * running, and says so rather than installing behind its back.
 */
const command: CommandModule<InstallOptions> = {
    description: 'Install an engine through the running server, and optionally download its weights',
    args: [{ name: 'engine', description: 'An engine id from the catalog, such as kokoro', required: true }],
    options: [
        { flags: '--server <url>', description: 'The server to ask. Default: 127.0.0.1 on the configured port', envVar: 'RHAPSODE_SERVER' },
        { flags: '--token <token>', description: 'management.token, for a server on another machine', envVar: 'RHAPSODE_MANAGEMENT_TOKEN' },
        { flags: '--pull', description: 'Download the default variant’s weights without asking', type: 'boolean' },
        { flags: '-y, --yes', description: 'Accept the licences without asking, for a script', type: 'boolean' },
    ],
    run: async (opts, ctx, args) => {
        const engine = args[0];
        if (engine === undefined) {
            ctx.logger.error('name an engine: `pnpm wizard install kokoro`');
            return 1;
        }

        let client: Client;
        try {
            // Lazily, because it needs the contract package built and the rest of the wizard does
            // not: the doctor has to run on a checkout that has never been built, to say so.
            client = await import('../lib/management.client.js');
        } catch {
            ctx.logger.error('the packages are not built. Run `pnpm build`, start the server, and try again.');
            return 1;
        }

        if (ctx.isInteractive()) {
            return wizard(ctx, { title: `rhapsode install ${engine}` }, async w =>
                install(engine, opts, ctx, client, interactiveUi(w, opts.yes === true)).then(code => {
                    if (code === 0) w.outro(`Done. POST /speak with "engine": "${engine}" to hear it.`);
                    return code;
                }),
            );
        }

        // Nobody to ask. A licence is accepted by saying so, never by default.
        return install(engine, opts, ctx, client, plainUi(ctx, opts.yes === true));
    },
};

async function install(engine: string, opts: InstallOptions, ctx: CliContext, client: Client, ui: Ui): Promise<number> {
    const read = readConfig(configPath(ctx.paths.repoRoot, ctx.env));
    const port = (read.status === 'ok' ? read.config.server?.port : undefined) ?? (await loadCore())?.DEFAULTS.port ?? 8080;
    const api = new client.ManagementClient(client.serverBase(port, opts.server), opts.token);

    try {
        const catalog = await api.catalog();
        const entry = catalog.find(candidate => candidate.id === engine);
        if (entry === undefined) {
            ui.error(`there is no engine "${engine}". The catalog has ${catalog.map(candidate => candidate.id).join(', ')}.`);
            return 1;
        }

        const variant = entry.defaultVariant;
        const wantsWeights = async () =>
            variant !== undefined &&
            (opts.pull === true ||
                (ctx.isInteractive() &&
                    (await ui.confirm(`Download the ${variant} weights now, so the first request does not wait on them?`, true))));

        if (entry.installed !== 'yes') {
            ui.info(`${entry.displayName} (${entry.package}): ${client.describeLicense(entry.license)}`);
            if (entry.license.notes !== undefined) ui.info(entry.license.notes);
            // No by default where the weights are not for commercial use: pressing return through a
            // prompt is not reading it, and that is the licence the core makes a caller name. § 10.
            if (!(await ui.confirm(`Install ${entry.displayName} under these licences?`, entry.license.weightsCommercialUse))) {
                ui.warn(ctx.isInteractive() ? 'Not installed.' : 'Not installed: pass --yes to accept the licences from a script.');
                return 1;
            }
            // Asked before the install starts, and done by the same job: a wizard stopped between an
            // install and a separate pull left an engine whose first request waited on the download.
            const pull = (await wantsWeights()) ? variant : undefined;
            const job = await follow(api, await api.install(engine, entry.license.weights, pull), `Installing ${entry.displayName}`, ui);
            if (job.state === 'failed' && job.step === 'weights') {
                ui.warn(`${entry.displayName} is installed, but its weights did not download. Run this again with --pull to retry.`);
            }
            return job.state === 'succeeded' ? 0 : 1;
        }

        ui.info(`${entry.displayName} is already installed.`);
        if (entry.outdated === true) ui.info(`An earlier release installed it. \`pnpm wizard reinstall ${engine}\` brings it up to date.`);
        if (!(await wantsWeights()) || variant === undefined) return 0;

        const pulled = await follow(api, await api.pull(engine, variant), `Downloading ${entry.displayName} ${variant}`, ui);
        if (pulled.state === 'failed' && pulled.error?.code === 'unsupported') {
            // Not a failure of the install: this engine's weights arrive on its first load instead.
            ui.info(`${entry.displayName} does not download ahead of time; its weights arrive on its first load.`);
            return 0;
        }
        return pulled.state === 'succeeded' ? 0 : 1;
    } catch (error) {
        reportFailure(error, client, ui);
        return 1;
    }
}

export default command;
