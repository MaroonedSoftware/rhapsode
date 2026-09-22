import type { CliContext } from '@maroonedsoftware/johnny5';
import type { FeedEvent, InstallJob } from '@rhapsode/contract';

import type { ManagementClient } from './management.client.js';
import { SERVER_ENTRY } from './paths.js';

type Client = typeof import('./management.client.js');

/** What a command needs from a terminal, whether a person is at it or not. */
export interface Ui {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
    success(message: string): void;
    confirm(message: string, initial: boolean): Promise<boolean>;
    /** A job in progress: a spinner at a terminal, a line per step in a log. */
    progress(title: string): { step(step: string): void; line(line: string): void; stop(message: string): void };
}

/** The slice of johnny5's wizard a `Ui` is built on. */
interface Wizard {
    log: { info(message: string): void; warn(message: string): void; error(message: string): void; success(message: string): void };
    confirm(options: { message: string; initialValue: boolean }): Promise<boolean>;
    spinner(): { start(message: string): void; message(message: string): void; stop(message: string): void };
}

/** A person at a terminal. `yes` answers every question for them. */
export function interactiveUi(w: Wizard, yes: boolean): Ui {
    return {
        info: message => w.log.info(message),
        warn: message => w.log.warn(message),
        error: message => w.log.error(message),
        success: message => w.log.success(message),
        confirm: async (message, initial) => yes || w.confirm({ message, initialValue: initial }),
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
    };
}

/** A script or a log. Nobody to ask, so a question is answered yes only by `--yes`. */
export function plainUi(ctx: CliContext, yes: boolean): Ui {
    return {
        info: message => ctx.logger.info(message),
        warn: message => ctx.logger.warn(message),
        error: message => ctx.logger.error(message),
        success: message => ctx.logger.success(message),
        confirm: async () => yes,
        progress: title => {
            ctx.logger.info(title);
            return {
                step: step => ctx.logger.info(`  ${step}`),
                line: line => ctx.logger.debug(`    ${line}`),
                stop: message => ctx.logger.info(message),
            };
        },
    };
}

/** Show a job's steps and output until it finishes, then say how it ended. */
export async function follow(api: ManagementClient, job: InstallJob, title: string, ui: Ui): Promise<InstallJob> {
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

/** A failure from the management API, in the sentence that says what to do about it. */
export function reportFailure(error: unknown, client: Client, ui: Ui): void {
    if (error instanceof client.ServerUnreachable) {
        ui.error(`${error.message}. Start the server with \`node ${SERVER_ENTRY}\` and run this again.`);
    } else if (error instanceof client.ManagementError && error.code === 'forbidden') {
        ui.error(`${error.message}. From another machine, pass --token with the server's management.token.`);
    } else {
        ui.error((error as Error).message);
    }
}

const truncate = (text: string, length: number): string => (text.length <= length ? text : `${text.slice(0, length - 1)}…`);
