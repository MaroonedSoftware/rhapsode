/**
 * The rhapsode core: routing, worker supervision and model residency.
 *
 * It never imports torch and holds no engine knowledge, which is the rule the whole design rests
 * on. Everything model-shaped lives behind a worker, and the core reaches it over HTTP.
 */

export { buildServer } from './server.js';
export { DEFAULTS, type RhapsodeConfig } from './config.js';
export { RhapsodeError, TAXONOMY, type ErrorCode } from './errors/rhapsode.error.js';
export { RhapsodeJsonLogger, type LogLevel } from './logging/rhapsode.logger.js';
export { EngineRegistry, type EngineEntry, type EngineState } from './registry/engine.registry.js';
export { CATALOG } from './registry/engines.catalog.js';
export { WorkerClient, type SpokenResponse } from './workers/worker.client.js';
export { WorkerRegistry } from './workers/worker.registry.js';
export { LocalWorkerHandle, RemoteWorkerHandle, resolveCommand, type WorkerHandle } from './workers/worker.handle.js';
