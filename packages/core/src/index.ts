/**
 * The rhapsode core: routing, worker supervision and model residency.
 *
 * It never imports torch and holds no engine knowledge, which is the rule the whole design rests
 * on. Everything model-shaped lives behind a worker, and the core reaches it over HTTP.
 */

export { buildServer, type BuildOptions } from './server.js';
export { DEFAULTS, type RhapsodeConfig } from './config.js';
export { RhapsodeError, TAXONOMY, type ErrorCode } from './errors/rhapsode.error.js';
export { RhapsodeJsonLogger, type LogLevel } from './logging/rhapsode.logger.js';
export { EngineRegistry, type EngineEntry, type EngineState } from './registry/engine.registry.js';
export { CATALOG, type CatalogRecord } from './registry/engines.catalog.js';
export { managementGuard } from './management/management.module.js';
export { isLocalCaller, isLoopback, isLoopbackOrigin, MANAGEMENT_ACCESS_POLICY } from './management/management.access.policy.js';
export { loadSettings, ManagedEngines, MANAGED_FILE, type ConfiguredEngine } from './registry/managed.engines.js';
export { WorkerClient, type SpokenResponse } from './workers/worker.client.js';
export { WorkerRegistry } from './workers/worker.registry.js';
export { LocalWorkerHandle, RemoteWorkerHandle, resolveCommand, type WorkerHandle } from './workers/worker.handle.js';
export { ResidencyManager, type ResidencyLease, type ResidencyPolicy } from './residency/residency.manager.js';
export { Mutex } from './residency/mutex.js';
export { audioFloor, ShortAudioError } from './speak/audio.floor.js';
export { EngineInstaller } from './install/engine.installer.js';
export { InstallJobs, type JobContext } from './install/install.jobs.js';
export { planInstall, type InstallPlan, type PlannedCommand, type InstallStep } from './install/install.plan.js';
export { spawnRunner, type CommandRunner, type OutputLine } from './install/command.runner.js';
