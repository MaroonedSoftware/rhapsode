import type { CommandModule } from '@maroonedsoftware/johnny5';

import { plainUi, reportFailure } from '../lib/job.ui.js';
import type { ManagementClient } from '../lib/management.client.js';
import { serverApi } from '../lib/server.api.js';
import { describeValue, patchFor, table, waitingNote } from '../lib/settings.format.js';

type Client = typeof import('../lib/management.client.js');
type Settings = Awaited<ReturnType<ManagementClient['settings']>>;

interface SettingsOptions {
    server?: string;
    token?: string;
    unset?: boolean;
}

/**
 * `pnpm wizard settings [key] [value]`: every setting, one setting, or a change to one, through
 * `GET` and `PATCH /settings`. protocol.md § 10, "Settings".
 *
 * One command rather than `settings set` and `settings unset` beneath a `settings` that lists: as a
 * command and a group at once, the group's `--server` took the flag from under its subcommands, and
 * `settings set k v --server X` asked the default port instead. `git config` has the same shape.
 *
 * A client and nothing more, as the web page is, so the two cannot disagree about what a setting is.
 * A value is read as the kind the setting already has, and the server refuses one it will not take.
 */
const command: CommandModule<SettingsOptions> = {
    description: 'Show every setting and where it came from, or change one. `-` as the value reads it from stdin',
    options: [
        { flags: '--server <url>', description: 'The server to ask. Default: 127.0.0.1 on the configured port', envVar: 'RHAPSODE_SERVER' },
        { flags: '--token <token>', description: 'management.token, for a server on another machine', envVar: 'RHAPSODE_MANAGEMENT_TOKEN' },
        { flags: '--unset', description: "Clear the setting, back to the config file's value or the default", type: 'boolean' },
    ],
    args: [
        { name: 'key', description: 'A setting as the list names it, such as residency.keepAliveSeconds' },
        {
            name: 'value',
            description: 'The new value: a number, true or false, or a comma-separated list. `-` reads it from stdin, which is how to give a token',
        },
    ],
    run: async (opts, ctx, args) => {
        const [key, typed] = args;
        if (opts.unset === true && (key === undefined || typed !== undefined)) {
            ctx.logger.error('name the one setting to clear: `pnpm wizard settings residency.keepAliveSeconds --unset`');
            return 1;
        }
        // On the command line a token lands in the shell's history; from stdin it does not.
        const value = typed === '-' ? (await readStdin()).replace(/\r?\n$/, '') : typed;

        let client: Client;
        try {
            client = await import('../lib/management.client.js');
        } catch {
            ctx.logger.error('the packages are not built. Run `pnpm build`, start the server, and try again.');
            return 1;
        }

        try {
            const api = await serverApi(ctx, opts, client);
            const before = await api.settings();
            if (key === undefined) {
                print(ctx.logger, before);
                return 0;
            }

            let patch;
            try {
                patch = patchFor(before, key, opts.unset === true ? null : value);
            } catch (error) {
                ctx.logger.error((error as Error).message);
                return 1;
            }
            if (patch === undefined) {
                // A key and no value: that one setting, as the table would show it.
                print(ctx.logger, { ...before, fields: before.fields.filter(field => field.key === key) });
                return 0;
            }

            const after = await api.updateSettings(patch);
            const field = after.fields.find(entry => entry.key === key);
            const from = field?.source === 'config' ? "the config file's value" : 'the default';
            if (opts.unset === true) {
                ctx.logger.success(
                    field?.applies === 'live'
                        ? `${key} is back to ${from}, ${describeValue(after, key)}.`
                        : `${key} is cleared, and ${from} takes effect when rhapsode restarts.`,
                );
            } else {
                ctx.logger.success(
                    field?.applies === 'live'
                        ? `${key} is now ${describeValue(after, key)}.`
                        : `${key} is saved, and takes effect when rhapsode restarts.`,
                );
            }
            const note = waitingNote(after);
            if (note !== undefined) ctx.logger.warn(note);
            return 0;
        } catch (error) {
            // A refusal that would have locked the caller out changed nothing, and says what to do
            // instead: a state to act on rather than a failure. § 10.
            if (error instanceof client.ManagementError && error.code === 'conflict') {
                ctx.logger.warn(`${error.message}. Nothing was changed.`);
            } else {
                reportFailure(error, client, plainUi(ctx, false));
            }
            return 1;
        }
    },
};

function print(logger: { info(message: string): void; warn(message: string): void }, settings: Settings): void {
    for (const line of table(settings)) logger.info(line);
    const note = waitingNote(settings);
    if (note !== undefined) logger.warn(note);
}

async function readStdin(): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString('utf8');
}

export default command;
