import type { ServerKitModule } from '@maroonedsoftware/fastify';

import type { StateStore } from './state.store.js';

/**
 * Closes the state database when the server stops. protocol.md § 10, "The state database".
 *
 * First in the module list so that it shuts down last, after every module that might still write to
 * it: an install stopped mid-`register` records its engine before this runs. A server built without
 * a database has nothing to close.
 */
export const stateModule = (store: StateStore | undefined): ServerKitModule => ({
    name: 'state',

    async setup() {},

    async shutdown() {
        store?.close();
    },
});
