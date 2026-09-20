import { AppConfig } from '@maroonedsoftware/appconfig';
import {
    authenticationPlugin,
    bodyParserPlugin,
    serverKitContextPlugin,
    ServerKitServerBuilder,
    type ServerKitModule,
    type ServerKitRouteMount,
} from '@maroonedsoftware/fastify';
import { Logger } from '@maroonedsoftware/logger';

import { rhapsodeErrorPlugin } from './errors/error.plugin.js';
import { healthRoutes } from './health/health.routes.js';
import { catalogRoutes } from './management/catalog.routes.js';
import { managementModule } from './management/management.module.js';
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
import { openaiRoutes } from './openai/openai.routes.js';
import { apiReferenceRoutes } from './reference/api.reference.routes.js';
import { dialogueRoutes } from './speak/dialogue.routes.js';
import { speakRoutes } from './speak/speak.routes.js';
import { workerModule } from './workers/worker.module.js';
import type { RhapsodeConfig } from './config.js';

/**
 * Everything a running rhapsode is, assembled but not started.
 *
 * `apps/server` is a composition root and nothing else; this is where the order lives, because the
 * order is a decision rather than a detail.
 */
export interface BuildOptions {
    /** The engines this API installed, and where it records them. Absent, the server cannot install. */
    managed?: ManagedEngines;
    /** How an install runs its commands. Replaced in tests, so an install can be driven without pip. */
    runner?: CommandRunner;
}

export async function buildServer(settings: RhapsodeConfig, logger?: Logger, options: BuildOptions = {}): Promise<ServerKitServerBuilder> {
    // AppConfig is keyed by string at its edges, and RhapsodeConfig is the typed view of the same
    // object. Services take their own section rather than this, which is ServerKit's rule.
    const config = new AppConfig(settings as unknown as Record<string, unknown>);
    const log = logger ?? new RhapsodeJsonLogger((settings.log?.level ?? 'info') as LogLevel);

    const builder = new ServerKitServerBuilder({ host: settings.server?.host ?? '::' });

    // Registration order is the shutdown contract: ServerKit runs `shutdown` hooks in reverse, so
    // this order means shutdown unwinds speak, then residency, then the workers. Registering the
    // worker module last would kill the children out from under streams still reading them.
    const modules: ServerKitModule[] = [
        managementModule(settings),
        engineModule(settings, options.managed),
        workerModule(settings),
        residencyModule(settings),
        // Last, so it shuts down first: a running pip is stopped before the workers it would register.
        installModule(settings, options.runner),
    ];

    const container = await builder.setup(config, log, modules);

    builder.setupPlugins(() => [
        // First, so that a request failing anywhere later still produces the protocol's envelope.
        rhapsodeErrorPlugin(container),
        serverKitContextPlugin(container),
        // Resolves a bearer token into a session for the management guard, and strips the header
        // from every request whether or not it is used, so no log line ever carries it. § 10.
        authenticationPlugin(),
        bodyParserPlugin(),
    ]);

    const routes: ServerKitRouteMount[] = [
        { plugin: healthRoutes },
        // The routes below, described. § 9.
        { plugin: apiReferenceRoutes },
        { plugin: enginesRoutes },
        { plugin: engineDetailRoutes },
        { plugin: speakRoutes },
        { plugin: dialogueRoutes },
        // OpenAI's speech route, translated into the one above. § 11.
        { plugin: openaiRoutes },
        { plugin: catalogRoutes },
        { plugin: installRoutes },
        // Given the lifecycle signal so a shutdown closes open event streams rather than waiting
        // out the grace period for clients that would otherwise watch forever.
        { plugin: installEventsRoutes(builder.lifecycleSignal) },
    ];
    builder.setupRoutes(routes);

    return builder;
}
