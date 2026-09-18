import { AuthenticationHandlerMap, AuthenticationSchemeHandler } from '@maroonedsoftware/authentication';
import type { ServerKitModule } from '@maroonedsoftware/fastify';
import { Logger } from '@maroonedsoftware/logger';
import { PolicyRegistryMap, PolicyService } from '@maroonedsoftware/policies';
import type { onRequestAsyncHookHandler } from 'fastify';
import { Container } from 'injectkit';

import type { RhapsodeConfig } from '../config.js';
import { ManagementTokenHandler } from './management.auth.js';
import { MANAGEMENT_ACCESS_POLICY, ManagementAccessPolicy, RhapsodePolicyService } from './management.access.policy.js';

/**
 * The pieces ServerKit's `authenticationPlugin` and `PolicyService` resolve from the container.
 *
 * The scheme handler is registered whether or not a token is configured, because the plugin asks for
 * it on every request. With no token its map is empty, every session stays invalid, and the policy
 * falls back to loopback alone.
 */
export const managementModule = (settings: RhapsodeConfig): ServerKitModule => ({
    name: 'management',

    async setup(registry) {
        const token = settings.management?.token;

        registry
            .register(AuthenticationHandlerMap)
            .useFactory(() => {
                const handlers = new AuthenticationHandlerMap();
                if (token !== undefined && token !== '') handlers.set('bearer', new ManagementTokenHandler(token));
                return handlers;
            })
            .asSingleton();
        registry
            .register(AuthenticationSchemeHandler)
            .useFactory(container => new AuthenticationSchemeHandler(container.get(AuthenticationHandlerMap), container.get(Logger)))
            .asSingleton();

        registry
            .register(ManagementAccessPolicy)
            .useFactory(() => new ManagementAccessPolicy())
            .asSingleton();
        registry
            .register(PolicyRegistryMap)
            .useFactory(() => new PolicyRegistryMap([[MANAGEMENT_ACCESS_POLICY, ManagementAccessPolicy]]))
            .asSingleton();
        registry
            .register(PolicyService)
            .useFactory(container => new RhapsodePolicyService(container.get(Container), container.get(PolicyRegistryMap)))
            .asSingleton();
    },
});

/**
 * Put on a management route's `onRequest`, so a refused caller is refused before its body is read
 * and before any stream is opened, which is the difference between refusing it and serving it.
 */
export const managementGuard: onRequestAsyncHookHandler = async request => {
    await request.container.get(PolicyService).assert(MANAGEMENT_ACCESS_POLICY, { ip: request.ip, session: request.authenticationSession });
};
