import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { DateTime } from 'luxon';

import { RhapsodeError } from '../errors/rhapsode.error.js';
import { EngineRegistry } from '../registry/engine.registry.js';
import { WorkerRegistry } from '../workers/worker.registry.js';
import { Mutex } from './mutex.js';

export interface ResidencyPolicy {
    /** One is the right answer for one GPU, which is why it is the default. */
    maxResidentModels: number;
    evictionWaitSeconds: number;
    /** `undefined` rather than 0, because 0 legitimately means "immediately". */
    idleUnloadSeconds?: number;
    idleTerminateSeconds?: number;
}

interface Resident {
    engineId: string;
    variant: string;
    leases: number;
    lastUsedAt: DateTime;
    idleTimer?: NodeJS.Timeout;
}

/** Held for the duration of the audio, not the duration of the handler. */
export interface ResidencyLease {
    engineId: string;
    variant: string;
    release(): void;
}

/**
 * Which models are resident, and which one gets evicted when the card is full.
 *
 * This lives in the core rather than in a worker because it is the only component that can see the
 * whole card. Putting it in each worker is what makes every adapter author reinvent an idle timer,
 * and none of them can see what the others are holding.
 */
@Injectable()
export class ResidencyManager {
    private readonly residents = new Map<string, Resident>();
    private readonly transition = new Mutex();
    private readonly waiters: (() => void)[] = [];

    constructor(
        private readonly workers: WorkerRegistry,
        private readonly engines: EngineRegistry,
        private readonly logger: Logger,
        private readonly policy: ResidencyPolicy,
    ) {}

    waiting = 0;
    blockedBy: string | undefined;

    /**
     * Make this engine resident with this variant, and hold it there until the lease is released.
     *
     * The lock is released before the caller synthesises anything. It is the lease, not the lock,
     * that keeps the model alive for the duration.
     */
    async acquire(engineId: string, variant: string): Promise<ResidencyLease> {
        const deadline = DateTime.utc().plus({ seconds: this.policy.evictionWaitSeconds });

        for (;;) {
            const lease = await this.transition.run(() => this.tryAcquire(engineId, variant));
            if (lease !== undefined) return lease;

            // Every resident is leased, so there is nothing to evict yet. Wait for one to finish
            // rather than refusing immediately: at maxResidentModels 1 that is simply a queue.
            if (DateTime.utc() > deadline) {
                throw new RhapsodeError(
                    'model_unavailable',
                    `waited ${this.policy.evictionWaitSeconds}s for a slot and ${this.blockedBy ?? 'another engine'} is still speaking`,
                );
            }
            await this.waitForRelease(deadline);
        }
    }

    private async tryAcquire(engineId: string, variant: string): Promise<ResidencyLease | undefined> {
        const existing = this.residents.get(engineId);

        if (existing !== undefined && existing.variant === variant) {
            this.hold(existing);
            return this.lease(existing);
        }

        if (existing !== undefined) {
            // Same engine, different weights. Unload rather than terminate: it is the same process
            // and the same runtime allocations, and the SDK's unload-then-load-once retry already
            // covers the OOM case this can run into.
            if (existing.leases > 0) return undefined;
            await this.release(existing, 'unload');
        }

        while (this.residents.size >= this.policy.maxResidentModels) {
            const victim = this.leastRecentlyUsed();
            if (victim === undefined) {
                this.blockedBy = [...this.residents.values()][0]?.engineId;
                return undefined;
            }
            // Terminate rather than unload, because the whole point of an eviction is getting the
            // card back. An unload leaves roughly 30% stranded on a card that then reads as free,
            // and the next load OOMs against a leak nobody can see.
            await this.release(victim, 'terminate');
        }

        const client = await this.workers.client(engineId);
        this.engines.observe(engineId, { model: 'loading', variant });
        try {
            await client.load(variant);
        } catch (error) {
            this.engines.observe(engineId, { model: 'unloaded', variant: undefined });
            throw error;
        }

        const resident: Resident = { engineId, variant, leases: 0, lastUsedAt: DateTime.utc() };
        this.residents.set(engineId, resident);
        this.engines.observe(engineId, { model: 'loaded', variant });
        this.hold(resident);
        return this.lease(resident);
    }

    private hold(resident: Resident): void {
        resident.leases += 1;
        resident.lastUsedAt = DateTime.utc();
        if (resident.idleTimer !== undefined) {
            clearTimeout(resident.idleTimer);
            resident.idleTimer = undefined;
        }
    }

    /**
     * Release, once, whatever ended the stream.
     *
     * The handler returns long before the audio does, so this cannot live at the end of a handler:
     * it lives on the stream's completion, and all three endings count. A double release lets the
     * next request evict a model that is still in use, which is why the flag is not optional.
     */
    private lease(resident: Resident): ResidencyLease {
        let released = false;
        return {
            engineId: resident.engineId,
            variant: resident.variant,
            release: () => {
                if (released) return;
                released = true;
                resident.leases = Math.max(0, resident.leases - 1);
                resident.lastUsedAt = DateTime.utc();
                if (resident.leases === 0) this.armIdleTimers(resident);
                this.wake();
            },
        };
    }

    private leastRecentlyUsed(): Resident | undefined {
        return [...this.residents.values()]
            .filter(resident => resident.leases === 0)
            .sort((left, right) => left.lastUsedAt.toMillis() - right.lastUsedAt.toMillis())[0];
    }

    private async release(resident: Resident, verb: 'unload' | 'terminate'): Promise<void> {
        if (resident.idleTimer !== undefined) clearTimeout(resident.idleTimer);
        this.residents.delete(resident.engineId);

        try {
            if (verb === 'terminate') {
                await this.workers.handle(resident.engineId).stop('evict');
            } else {
                const client = await this.workers.client(resident.engineId);
                await client.unload();
            }
        } catch (error) {
            // A model we were evicting anyway. Losing the process is the outcome we wanted.
            this.logger.warn('evicting a model did not go cleanly', { engine: resident.engineId, verb, error });
        }
        this.engines.observe(resident.engineId, { model: 'unloaded', variant: undefined });
        this.logger.info('evicted', { engine: resident.engineId, verb });
    }

    /**
     * Both off by default, because they trade a cold start for memory nobody is asking for.
     *
     * A timer's view is always stale, so it re-checks under the lock before acting.
     */
    private armIdleTimers(resident: Resident): void {
        const unloadAfter = this.policy.idleUnloadSeconds;
        const terminateAfter = this.policy.idleTerminateSeconds;
        const chosen =
            terminateAfter !== undefined && (unloadAfter === undefined || terminateAfter <= unloadAfter)
                ? ({ seconds: terminateAfter, verb: 'terminate' } as const)
                : unloadAfter !== undefined
                  ? ({ seconds: unloadAfter, verb: 'unload' } as const)
                  : undefined;
        if (chosen === undefined) return;

        const timer = setTimeout(() => {
            void this.transition.run(async () => {
                const current = this.residents.get(resident.engineId);
                if (current === undefined || current.leases > 0) return;
                await this.release(current, chosen.verb);
            });
        }, chosen.seconds * 1000);
        timer.unref();
        resident.idleTimer = timer;
    }

    private async waitForRelease(deadline: DateTime): Promise<void> {
        this.waiting += 1;
        try {
            await new Promise<void>(fulfil => {
                const timer = setTimeout(fulfil, Math.max(50, deadline.diffNow().as('milliseconds')));
                timer.unref();
                this.waiters.push(() => {
                    clearTimeout(timer);
                    fulfil();
                });
            });
        } finally {
            this.waiting -= 1;
        }
    }

    private wake(): void {
        this.blockedBy = undefined;
        const waiter = this.waiters.shift();
        waiter?.();
    }

    summary(): { resident: number; max: number; waiting: number; blockedBy?: string } {
        return {
            resident: this.residents.size,
            max: this.policy.maxResidentModels,
            waiting: this.waiting,
            ...(this.blockedBy === undefined ? {} : { blockedBy: this.blockedBy }),
        };
    }
}
