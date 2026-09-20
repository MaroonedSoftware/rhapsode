import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import type { DateTime } from 'luxon';

import { RhapsodeError } from '../errors/rhapsode.error.js';
import { EngineRegistry } from '../registry/engine.registry.js';
import type { WorkerClient } from '../workers/worker.client.js';
import type { WorkerHandle } from '../workers/worker.handle.js';
import { type ResidencyClock, systemClock } from './residency.clock.js';
import { Mutex } from './mutex.js';

export interface ResidencyPolicy {
    /** One is the right answer for one GPU, which is why it is the default. */
    maxResidentModels: number;
    evictionWaitSeconds: number;
    /**
     * How long a model with nothing left to do stays on the card.
     *
     * `-1` keeps it until something else needs the room, `0` frees it the moment the last request
     * lets go. A number rather than the absent-means-off pair this replaced, because "off" turned
     * out to be the wrong default: a card held by a model nobody has asked for in an hour is a card
     * the next process cannot have. § 3.
     */
    keepAliveSeconds: number;
}

/**
 * The two things residency asks of a worker, which is far less than `WorkerRegistry` offers.
 *
 * Declared here rather than imported because a test for an eviction rule should not have to build a
 * supervisor and spawn a Python process to get at one. `WorkerRegistry` satisfies it structurally,
 * so nothing at the wiring end changes.
 */
export interface ResidentWorkers {
    client(id: string): Promise<Pick<WorkerClient, 'load' | 'unload'>>;
    handle(id: string): Pick<WorkerHandle, 'stop'>;
}

interface Resident {
    engineId: string;
    variant: string;
    leases: number;
    lastUsedAt: DateTime;
    /** Absent while the model is speaking, or when its keep-alive says never. */
    expiresAt?: DateTime;
    cancelIdle?: () => void;
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
        private readonly workers: ResidentWorkers,
        private readonly engines: EngineRegistry,
        private readonly logger: Logger,
        private readonly policy: ResidencyPolicy,
        private readonly clock: ResidencyClock = systemClock,
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
        const deadline = this.clock.now().plus({ seconds: this.policy.evictionWaitSeconds });

        for (;;) {
            const lease = await this.transition.run(() => this.tryAcquire(engineId, variant));
            if (lease !== undefined) return lease;

            // Every resident is leased, so there is nothing to evict yet. Wait for one to finish
            // rather than refusing immediately: at maxResidentModels 1 that is simply a queue.
            if (this.clock.now() > deadline) {
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

        const resident: Resident = { engineId, variant, leases: 0, lastUsedAt: this.clock.now() };
        this.residents.set(engineId, resident);
        this.engines.observe(engineId, { model: 'loaded', variant });
        this.hold(resident);
        return this.lease(resident);
    }

    /**
     * Take an engine out of residency for good, and run `removal` while nothing can load it.
     *
     * Under the transition lock, so that a `/speak` arriving mid-uninstall cannot spawn the worker
     * being removed. Refused while the engine is speaking: an uninstall that cut off a stream in
     * progress would hand that caller a truncated file for a reason it could not have predicted.
     */
    async forget(engineId: string, removal: () => Promise<void>): Promise<void> {
        await this.transition.run(async () => {
            const resident = this.residents.get(engineId);
            if (resident !== undefined && resident.leases > 0) {
                throw new RhapsodeError('conflict', `"${engineId}" is speaking; remove it once it has finished`);
            }
            resident?.cancelIdle?.();
            this.residents.delete(engineId);
            await removal();
        });
    }

    private hold(resident: Resident): void {
        resident.leases += 1;
        resident.lastUsedAt = this.clock.now();
        resident.cancelIdle?.();
        resident.cancelIdle = undefined;
        resident.expiresAt = undefined;
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
                resident.lastUsedAt = this.clock.now();
                if (resident.leases === 0) this.armExpiry(resident);
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
        resident.cancelIdle?.();
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
     * Put a deadline on a model nobody is holding.
     *
     * Terminate rather than unload, for the reason § 3 measured: an unload leaves roughly 30%
     * stranded, and a card given away 30% at a time is gone by morning. An expiry is not a promise
     * the model survives that long either, since a budget eviction can still take it first.
     */
    private armExpiry(resident: Resident): void {
        const seconds = this.policy.keepAliveSeconds;
        if (seconds < 0) return;

        resident.expiresAt = this.clock.now().plus({ seconds });
        resident.cancelIdle = this.clock.after(seconds, async () => {
            await this.transition.run(async () => {
                // A timer's view is always stale. Cancelling covers the model that was picked up
                // again, but not a callback already on its way when that happened, so the deadline
                // is checked rather than assumed: without this, a model used a millisecond ago is
                // terminated by a timer armed for the request before it.
                const current = this.residents.get(resident.engineId);
                if (current !== resident || current.leases > 0) return;
                if (current.expiresAt === undefined || current.expiresAt > this.clock.now()) return;
                await this.release(current, 'terminate');
            });
        });
    }

    /**
     * Drop every expiry, for a core that is going down anyway.
     *
     * A timer that fires after the workers have stopped would lazily build a fresh handle for an
     * engine nothing is going to speak, and shutdown would then wait on it.
     */
    stopExpiry(): void {
        for (const resident of this.residents.values()) {
            resident.cancelIdle?.();
            resident.cancelIdle = undefined;
            resident.expiresAt = undefined;
        }
    }

    private async waitForRelease(deadline: DateTime): Promise<void> {
        this.waiting += 1;
        try {
            await new Promise<void>(fulfil => {
                const seconds = Math.max(0.05, deadline.diff(this.clock.now()).as('seconds'));
                const cancel = this.clock.after(seconds, async () => fulfil());
                this.waiters.push(() => {
                    cancel();
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
