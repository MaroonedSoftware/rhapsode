import type { ServerKitModule } from '@maroonedsoftware/fastify';
import { Logger } from '@maroonedsoftware/logger';
import {
    McpConfig,
    McpDispatcher,
    McpResourceHandlerMap,
    McpServerFactory,
    McpSessionRegistry,
    McpToolHandlerMap,
    type McpToolHandler,
} from '@maroonedsoftware/mcp';

import { CORE_VERSION } from '../core.version.js';
import { EngineCapabilitiesTool, ListEnginesTool, ListVoicesTool } from './engine.tools.js';
import { LoopbackClient } from './mcp.loopback.js';

/**
 * `/mcp`'s pieces, from ServerKit's MCP package. protocol.md § 12.
 *
 * Stateless, and open like `/speak`: `allowUnauthenticated` is the package's way of saying so on
 * purpose, and no `McpAuthenticationHandler` is registered, so the management token is never
 * mistaken for an MCP one. The route applies the origin rule instead.
 */
export const mcpModule = (): ServerKitModule => ({
    name: 'mcp',

    async setup(registry) {
        const config: McpConfig = {
            serverName: 'rhapsode',
            version: CORE_VERSION,
            sessionMode: 'stateless',
            allowUnauthenticated: true,
        };
        registry
            .register(McpConfig)
            .useFactory(() => config)
            .asSingleton();
        registry
            .register(LoopbackClient)
            .useFactory(() => new LoopbackClient())
            .asSingleton();

        registry
            .register(McpToolHandlerMap)
            .useFactory(container => {
                const loopback = container.get(LoopbackClient);
                const tools: McpToolHandler[] = [new ListEnginesTool(loopback), new EngineCapabilitiesTool(loopback), new ListVoicesTool(loopback)];
                return new McpToolHandlerMap(tools.map(tool => [tool.definition.name, tool]));
            })
            .asSingleton();
        registry
            .register(McpResourceHandlerMap)
            .useFactory(() => new McpResourceHandlerMap())
            .asSingleton();

        registry
            .register(McpServerFactory)
            .useFactory(
                container =>
                    new McpServerFactory(
                        container.get(McpToolHandlerMap),
                        container.get(McpResourceHandlerMap),
                        container.get(McpConfig),
                        container.get(Logger),
                    ),
            )
            .asSingleton();
        registry
            .register(McpSessionRegistry)
            .useFactory(container => new McpSessionRegistry(container.get(McpServerFactory), container.get(Logger)))
            .asSingleton();
        registry
            .register(McpDispatcher)
            .useFactory(
                container =>
                    new McpDispatcher(
                        container.get(McpServerFactory),
                        container.get(McpSessionRegistry),
                        container.get(McpConfig),
                        container.get(Logger),
                    ),
            )
            .asSingleton();
    },
});
