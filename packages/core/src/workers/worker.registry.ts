import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';

import { RhapsodeError } from '../errors/rhapsode.error.js';
import { EngineRegistry } from '../registry/engine.registry.js';
import { LocalWorkerHandle, RemoteWorkerHandle, type SupervisorOptions, type WorkerHandle } from './worker.handle.js';
import type { WorkerClient } from './worker.client.js';

/**
 * Every worker, local or remote, behind one interface.
 *
 * Nothing above this line knows which kind it is holding. That is the property § 1 is built on, and
 * it is only true because the difference is confined to two classes below.
 */
@Injectable()
export class WorkerRegistry {
    private readonly handles = new Map<string, WorkerHandle>();

    constructor(
        private readonly engines: EngineRegistry,
        private readonly logger: Logger,
        private readonly options: SupervisorOptions,
    ) {}

    handle(id: string): WorkerHandle {
        const existing = this.handles.get(id);
        if (existing !== undefined) return existing;

        const entry = this.engines.entry(id);
        if (entry === undefined) throw RhapsodeError.unknownEngine(id, this.engines.ids());

        const handle: WorkerHandle =
            entry.url === undefined
                ? new LocalWorkerHandle(id, entry, this.options, this.logger, state => this.engines.observe(id, state as never))
                : new RemoteWorkerHandle(id, entry.url);

        this.handles.set(id, handle);
        return handle;
    }

    /** Bring the process up if it is not, which is cheap. Loading a model is not, and is separate. */
    async client(id: string): Promise<WorkerClient> {
        return this.handle(id).ensureUp();
    }

    async stopAll(): Promise<void> {
        await Promise.allSettled([...this.handles.values()].map(handle => handle.stop('shutdown')));
        this.handles.clear();
    }
}
