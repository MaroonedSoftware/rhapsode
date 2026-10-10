import fastifyWebsocket from '@fastify/websocket';
import { AppConfig } from '@maroonedsoftware/appconfig';
import {
    authenticationPlugin,
    bodyParserPlugin,
    serverKitContextPlugin,
    serverKitPlugin,
    ServerKitServerBuilder,
    type ServerKitModule,
    type ServerKitRouteMount,
} from '@maroonedsoftware/fastify';
import { Logger } from '@maroonedsoftware/logger';

import { rhapsodeErrorPlugin } from './errors/error.plugin.js';
import { healthRoutes } from './health/health.routes.js';
import { catalogRoutes } from './management/catalog.routes.js';
import { managementModule } from './management/management.module.js';
import { mcpModule } from './mcp/mcp.module.js';
import { mcpRoutes } from './mcp/mcp.routes.js';
import { RhapsodeJsonLogger, type LogLevel } from './logging/rhapsode.logger.js';
import { engineModule } from './registry/engine.module.js';
import type { ManagedEngines } from './registry/managed.engines.js';
import type { CommandRunner } from './install/command.runner.js';
import { installModule } from './install/install.module.js';
import { installRoutes } from './install/install.routes.js';
import { installEventsRoutes } from './install/install.events.routes.js';
import { engineDetailRoutes } from './registry/engine.detail.routes.js';
import { enginesRoutes } from './registry/engine.routes.js';
import { residencyModule } from './residency/residency.module.js';
import { residencyRoutes } from './residency/residency.routes.js';
import { openaiRoutes } from './openai/openai.routes.js';
import { apiReferenceRoutes } from './reference/api.reference.routes.js';
import { dialogueRoutes } from './speak/dialogue.routes.js';
import { speakRoutes } from './speak/speak.routes.js';
import { speakStreamRoutes } from './speak/speak.stream.routes.js';
import { settingsModule } from './settings/settings.module.js';
import { settingsRoutes } from './settings/settings.routes.js';
import { stateModule } from './state/state.module.js';
import { updateModule } from './update/update.module.js';
import { updateRoutes } from './update/update.routes.js';
import { workerModule } from './workers/worker.module.js';
import { WorkerRegistry } from './workers/worker.registry.js';
import { InstallJobs } from './install/install.jobs.js';
import { EngineInstaller } from './install/engine.installer.js';
import { SettingsService } from './settings/settings.service.js';
import { DEFAULTS, type RhapsodeConfig } from './config.js';

/**
 * Everything a running rhapsode is, assembled but not started.
 *
 * `apps/server` is a composition root and nothing else; this is where the order lives, because the
 * order is a decision rather than a detail.
 */
export interface BuildOptions {
    /**
     * The engines this API installed, and the state database it records them in, which the server
     * closes when it stops. Absent, the server cannot install.
     */
    managed?: ManagedEngines;
    /** How an install runs its commands. Replaced in tests, so an install can be driven without pip. */
    runner?: CommandRunner;
    /** How the update check reaches GitHub. Replaced in tests, so none of them ever does. § 9. */
    fetch?: typeof fetch;
    /**
     * The operator's config file on its own, which is how `/settings` knows a value came from it.
     * Absent, the settings the server is built from count as the file. § 10.
     */
    operator?: RhapsodeConfig;
}

export async function buildServer(settings: RhapsodeConfig, logger?: Logger, options: BuildOptions = {}): Promise<ServerKitServerBuilder> {
    // AppConfig is keyed by string at its edges, and RhapsodeConfig is the typed view of the same
    // object. Services take their own section rather than this, which is ServerKit's rule.
    const config = new AppConfig(settings as unknown as Record<string, unknown>);
    const log = logger ?? new RhapsodeJsonLogger((settings.log?.level ?? DEFAULTS.logLevel) as LogLevel);

    const builder = new ServerKitServerBuilder({ host: settings.server?.host ?? DEFAULTS.host });

    // Registration order is the shutdown contract: ServerKit runs `shutdown` hooks in reverse, so
    // this order means shutdown unwinds speak, then residency, then the workers. Registering the
    // worker module last would kill the children out from under streams still reading them.
    const modules: ServerKitModule[] = [
        // First, so the state database closes after everything that might write to it.
        stateModule(options.managed?.store),
        settingsModule(settings, options.managed?.store, options.operator),
        managementModule(settings),
        engineModule(settings, options.managed),
        workerModule(settings),
        residencyModule(),
        updateModule(options.fetch),
        mcpModule(),
        // Last, so it shuts down first: a running pip is stopped before the workers it would register.
        installModule(settings, options.runner),
    ];

    const container = await builder.setup(config, log, modules);

    // The children are stopped when the app closes, not only when `start()` shuts it down. ServerKit
    // runs module `shutdown` hooks off the listening socket's `close` event, so a core that was
    // built and closed without ever listening (every test here, and anything embedding the core
    // through `inject`) never ran them: by 2026-10-07 the tests had left 1,010 tone workers on one
    // Mac, about 9.5 GB. Under `start()` this fires in the same tick as the socket's `close` event
    // and so alongside ServerKit's own pass (measured on Fastify 5.12), which is why both halves are
    // safe to call twice: the second caller waits on the first rather than signalling again. Pip
    // first, then workers, as the modules order it.
    builder.app.addHook('onClose', async () => {
        await container.get(InstallJobs).stop();
        await container.get(WorkerRegistry).stopAll();
    });

    // The upgrade step that used to be a curl, for an operator who asked for it. Once ready rather
    // than at setup, so the jobs run on a server whose registry, workers and routes all exist, and
    // never awaited, so a reinstall's minutes of pip are not minutes before the port opens. § 10.
    builder.app.addHook('onReady', async () => {
        if (!container.get(SettingsService).update.reinstallOutdated) return;
        const { jobs, skipped } = container.get(EngineInstaller).reinstallOutdated();
        if (jobs.length === 0 && skipped.length === 0) return;
        log.info('reinstalling the engines behind this core, as update.reinstallOutdated asks', {
            jobs: jobs.map(job => ({ engine: job.engine, job: job.id })),
            skipped,
        });
    });

    builder.setupPlugins(() => [
        // First, so that a request failing anywhere later still produces the protocol's envelope.
        rhapsodeErrorPlugin(container),
        serverKitContextPlugin(container),
        // Resolves a bearer token into a session for the management guard, and strips the header
        // from every request whether or not it is used, so no log line ever carries it. § 10.
        authenticationPlugin(),
        bodyParserPlugin(),
        // Upgrades for `/speak/stream`, on the root instance so the route plugin below can use them. § 6.
        serverKitPlugin('websocket', async app => {
            await app.register(fastifyWebsocket);
        }),
    ]);

    const routes: ServerKitRouteMount[] = [
        { plugin: healthRoutes },
        // The routes below, described. § 9.
        { plugin: apiReferenceRoutes },
        { plugin: enginesRoutes },
        { plugin: engineDetailRoutes },
        { plugin: residencyRoutes },
        { plugin: speakRoutes },
        // Text in as a model writes it, through the route above a sentence at a time. § 6.
        { plugin: speakStreamRoutes },
        { plugin: dialogueRoutes },
        // OpenAI's speech route, translated into the one above. § 11.
        { plugin: openaiRoutes },
        // Tools for an agent, each a request to one of the routes above. § 12.
        { plugin: mcpRoutes },
        { plugin: catalogRoutes },
        { plugin: updateRoutes },
        { plugin: settingsRoutes },
        { plugin: installRoutes },
        // Given the lifecycle signal so a shutdown closes open event streams rather than waiting
        // out the grace period for clients that would otherwise watch forever.
        { plugin: installEventsRoutes(builder.lifecycleSignal) },
    ];
    builder.setupRoutes(routes);

    return builder;
}
