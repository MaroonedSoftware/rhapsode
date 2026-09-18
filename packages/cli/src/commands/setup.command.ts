import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { wizard, type CliContext, type CommandModule } from '@maroonedsoftware/johnny5';

import { pythonVenv } from '../checks/python.venv.js';
import { loadCore } from '../lib/core.js';
import { configPath, displayPath, SERVER_ENTRY, VENV } from '../lib/paths.js';
import { PYPI_HOSTS, pythonSync } from '../lib/python.sync.js';
import { readConfig, renderConfig, starterConfig } from '../lib/rhapsode.config.js';

const run = (ctx: CliContext, command: string, args: string[]) => ctx.shell.runStreaming(command, args, { cwd: ctx.paths.repoRoot });

const command: CommandModule = {
    description: 'First-run setup: the Python venv, a build, rhapsode.config.json and a conformance run',
    run: async (_opts, ctx) => {
        if (!ctx.isInteractive()) {
            ctx.logger.error(
                'wizard setup asks questions, so it needs an interactive terminal. See `pnpm wizard doctor` for a non-interactive check.',
            );
            return 1;
        }

        return wizard(ctx, { title: 'rhapsode setup' }, async w => {
            // 1. The shared dev venv: the worker SDK, tone, the conformance suite, and the Chatterbox
            //    adapter without its engine.
            const venvHealthy = (await pythonVenv.run(ctx)).ok;
            if (venvHealthy) w.log.info(`${VENV} is already synced.`);
            if (!venvHealthy || (await w.confirm({ message: `Re-sync ${VENV} anyway?`, initialValue: false }))) {
                let exit = await pythonSync(ctx);
                // The one failure with a known local cure. A proxy that intercepts TLS (a corporate
                // network, a sandbox) makes pip's certificate check fail against a certificate pip
                // cannot trust. Offered per run and never written down: see scripts/python.mjs.
                if (
                    exit !== 0 &&
                    (await w.confirm({
                        message: `python:sync failed. If pip could not verify a certificate, retry trusting ${PYPI_HOSTS} for this run only?`,
                        initialValue: false,
                    }))
                ) {
                    exit = await pythonSync(ctx, { trustPypi: true });
                }
                if (exit !== 0) {
                    w.log.error(`python:sync exited ${exit}`);
                    return exit;
                }
                w.log.success(`synced ${VENV}`);
            }

            // 2. The server and the packages it runs from.
            if (await w.confirm({ message: 'Build the TypeScript packages?', initialValue: true })) {
                const exit = await run(ctx, 'pnpm', ['build']);
                if (exit !== 0) {
                    w.log.error(`pnpm build exited ${exit}`);
                    return exit;
                }
            }

            // 3. What this box has. Left alone if it exists: it is the operator's file, not ours.
            const path = configPath(ctx.paths.repoRoot, ctx.env);
            const shown = displayPath(ctx.paths.repoRoot, path);
            const existing = readConfig(path);
            let port: number | undefined;
            if (existing.status === 'ok') {
                port = existing.config.server?.port;
                w.log.info(`${shown} already exists; leaving it alone.`);
            } else if (existing.status === 'invalid') {
                w.log.warn(`${shown} does not parse (${existing.error}); leaving it for you to fix.`);
            } else {
                const core = await loadCore();
                if (!core) {
                    w.log.error(`the core is not built, so ${shown} cannot be written. Run \`pnpm build\` and then this again.`);
                    return 1;
                }
                const answer = await w.text({
                    message: 'Port for the server',
                    initialValue: String(core.DEFAULTS.port),
                    validate: value => (/^\d+$/.test(value ?? '') && Number(value) > 0 && Number(value) < 65_536 ? undefined : 'A port number'),
                });
                port = Number(answer);
                writeFileSync(path, renderConfig(starterConfig(port, resolve(ctx.paths.repoRoot, VENV))));
                w.log.success(`wrote ${shown} with the tone engine on ${VENV}`);
            }

            // 4. Proof the worker speaks the contract. Seconds, and it is the same command an engine
            //    author runs against their own worker.
            if (await w.confirm({ message: 'Run the conformance suite against the tone engine?', initialValue: true })) {
                const exit = await run(ctx, 'pnpm', ['conform']);
                if (exit !== 0) w.log.warn(`conformance exited ${exit}. \`pnpm wizard doctor\` may say why.`);
            }

            const where = port === undefined ? '' : `, then \`curl localhost:${port}/engines\``;
            w.outro(`Ready. Start the server with \`node ${SERVER_ENTRY}\`${where}.`);
            return 0;
        });
    },
};

export default command;
