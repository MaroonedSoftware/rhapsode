import { wizard, type CliContext, type CommandModule } from '@maroonedsoftware/johnny5';
import type { FeedEvent, InstallJob } from '@rhapsode/contract';

import { loadCore } from '../lib/core.js';
import { configPath, SERVER_ENTRY } from '../lib/paths.js';
import { readConfig } from '../lib/rhapsode.config.js';

type Client = typeof import('../lib/management.client.js');

interface InstallOptions {
    server?: string;
    token?: string;
    pull?: boolean;
    yes?: boolean;
}

/** What the command needs from a terminal, whether a person is at it or not. */
interface Ui {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
    success(message: string): void;
    confirm(message: string, initial: boolean): Promise<boolean>;
    /** A job in progress: a spinner at a terminal, a line per step in a log. */
    progress(title: string): { step(step: string): void; line(line: string): void; stop(message: string): void };
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
                install(engine, opts, ctx, client, {
                    info: message => w.log.info(message),
                    warn: message => w.log.warn(message),
                    error: message => w.log.error(message),
                    success: message => w.log.success(message),
                    confirm: async (message, initial) => opts.yes === true || w.confirm({ message, initialValue: initial }),
                    progress: title => {
                        const spinner = w.spinner();
                        spinner.start(title);
                        let current = title;
                        return {
                            step: step => {
                                current = `${title}: ${step}`;
                                spinner.message(current);
                            },
                            // The newest line under the step, so a long pip resolve visibly moves.
                            line: line => spinner.message(`${current}  ${truncate(line.trim(), 60)}`),
                            stop: message => spinner.stop(message),
                        };
                    },
                }).then(code => {
                    if (code === 0) w.outro(`Done. POST /speak with "engine": "${engine}" to hear it.`);
                    return code;
                }),
            );
        }

        return install(engine, opts, ctx, client, {
            info: message => ctx.logger.info(message),
            warn: message => ctx.logger.warn(message),
            error: message => ctx.logger.error(message),
            success: message => ctx.logger.success(message),
            // Nobody to ask. A licence is accepted by saying so, never by default.
            confirm: async () => opts.yes === true,
            progress: title => {
                ctx.logger.info(title);
                return {
                    step: step => ctx.logger.info(`  ${step}`),
                    line: line => ctx.logger.debug(`    ${line}`),
                    stop: message => ctx.logger.info(message),
                };
            },
        });
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

        if (entry.installed === 'yes') {
            ui.info(`${entry.displayName} is already installed.`);
        } else {
            ui.info(`${entry.displayName} (${entry.package}): ${client.describeLicense(entry.license)}`);
            if (entry.license.notes !== undefined) ui.info(entry.license.notes);
            if (!(await ui.confirm(`Install ${entry.displayName} under these licences?`, true))) {
                ui.warn(ctx.isInteractive() ? 'Not installed.' : 'Not installed: pass --yes to accept the licences from a script.');
                return 1;
            }
            const job = await follow(api, await api.install(engine), `Installing ${entry.displayName}`, ui);
            if (job.state !== 'succeeded') return 1;
        }

        const variant = entry.defaultVariant;
        if (variant === undefined) return 0;
        const wanted =
            opts.pull === true ||
            (ctx.isInteractive() && (await ui.confirm(`Download the ${variant} weights now, so the first request does not wait on them?`, true)));
        if (!wanted) return 0;

        const pulled = await follow(api, await api.pull(engine, variant), `Downloading ${entry.displayName} ${variant}`, ui);
        if (pulled.state === 'failed' && pulled.error?.code === 'unsupported') {
            // Not a failure of the install: this engine's weights arrive on its first load instead.
            ui.info(`${entry.displayName} does not download ahead of time; its weights arrive on its first load.`);
            return 0;
        }
        return pulled.state === 'succeeded' ? 0 : 1;
    } catch (error) {
        if (error instanceof client.ServerUnreachable) {
            ui.error(`${error.message}. Start the server with \`node ${SERVER_ENTRY}\` and run this again.`);
        } else if (error instanceof client.ManagementError && error.code === 'forbidden') {
            ui.error(`${error.message}. From another machine, pass --token with the server's management.token.`);
        } else {
            ui.error((error as Error).message);
        }
        return 1;
    }
}

async function follow(api: InstanceType<Client['ManagementClient']>, job: InstallJob, title: string, ui: Ui): Promise<InstallJob> {
    const progress = ui.progress(title);
    const finished = await api.follow(job.id, (event: FeedEvent) => {
        if (event.kind === 'progress' && event.progress?.status === 'running') progress.step(event.progress.phase);
        else if (event.kind === 'log' && event.message !== undefined) progress.line(event.message);
    });

    if (finished.state === 'succeeded') {
        progress.stop(`${title}: done`);
    } else {
        progress.stop(`${title}: failed at ${finished.step ?? 'the start'}`);
        if (finished.error?.code !== 'unsupported') ui.error(finished.error?.message ?? 'the job failed and said nothing');
    }
    return finished;
}

const truncate = (text: string, length: number): string => (text.length <= length ? text : `${text.slice(0, length - 1)}…`);

export default command;
