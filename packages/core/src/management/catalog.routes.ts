import type { CatalogEntry } from '@rhapsode/contract';
import type { FastifyPluginAsync } from 'fastify';

import { InstallJobs } from '../install/install.jobs.js';
import { EngineRegistry } from '../registry/engine.registry.js';
import { CATALOG } from '../registry/engines.catalog.js';
import { ManagedEngines } from '../registry/managed.engines.js';

/**
 * `GET /catalog`: every engine that exists, and whether this box has it.
 *
 * Open to every caller, unlike the rest of § 10. It only reads, and the licences in it are what § 4
 * promises before install, which is the one point at which a weights licence can change a decision.
 */
export const catalogRoutes: FastifyPluginAsync = async app => {
    app.get('/catalog', async request => {
        const engines = request.container.get(EngineRegistry);
        const managed = request.container.get(ManagedEngines);
        const jobs = request.container.get(InstallJobs);

        return Object.entries(CATALOG).map(([id, record]): CatalogEntry => {
            const workerVersion = engines.workerVersion(id);
            const outdated = engines.outdated(id);
            return {
                id,
                displayName: record.displayName,
                license: record.license,
                package: record.package,
                ...(record.defaultVariant === undefined ? {} : { defaultVariant: record.defaultVariant }),
                installed: engines.has(id) ? 'yes' : jobs.pending(id)?.kind === 'install' ? 'installing' : 'no',
                managed: managed.isManaged(id),
                ...(workerVersion === undefined ? {} : { workerVersion }),
                ...(outdated === undefined ? {} : { outdated }),
            };
        });
    });
};
