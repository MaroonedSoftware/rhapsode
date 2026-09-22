import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import type { DateTime } from 'luxon';

import type { ResidentModel } from '@rhapsode/contract';

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

/** What a request may say about how long it wants its model kept. § 3. */
export interface ResidencyRequest {
    keepAliveSeconds?: number;
}

interface Resident {
    engineId: string;
    variant: string;
    leases: number;
    lastUsedAt: DateTime;
    /** What the last request to take a lease asked for, which outranks the engine and the server. */
    keepAliveSeconds?: number;
    /** What the worker measured this model taking, when it could measure anything. § 3. */
    sizeBytes?: number;
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
    async acquire(engineId: string, variant: string, wanted: ResidencyRequest = {}): Promise<ResidencyLease> {
        const deadline = this.clock.now().plus({ seconds: this.policy.evictionWaitSeconds });

        for (;;) {
            const lease = await this.transition.run(() => this.tryAcquire(engineId, variant, wanted));
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

    private async tryAcquire(engineId: string, variant: string, wanted: ResidencyRequest): Promise<ResidencyLease | undefined> {
        const existing = this.residents.get(engineId);

        if (existing !== undefined && existing.variant === variant) {
            this.hold(existing, wanted);
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
        let health;
        try {
            health = await client.load(variant);
        } catch (error) {
            this.engines.observe(engineId, { model: 'unloaded', variant: undefined });
            throw error;
        }

        const resident: Resident = {
            engineId,
            variant,
            leases: 0,
            lastUsedAt: this.clock.now(),
            // The one moment the core is told, and it used to throw the answer away.
            ...(typeof health?.modelBytes === 'number' ? { sizeBytes: health.modelBytes } : {}),
        };
        this.residents.set(engineId, resident);
        this.engines.observe(engineId, { model: 'loaded', variant });
        this.hold(resident, wanted);
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

    /**
     * Take an engine out of residency and run `swap` while nothing can load it, waiting for it to
     * stop speaking rather than refusing. A reinstall's `register` step. § 10.
     *
     * `forget` refuses a speaking engine because its caller is there to be told. A reinstall's caller
     * has usually gone, and on a box that is never quiet for long a reinstall that refused whenever
     * the engine was speaking would never finish. Past `waitSeconds` it gives up with `conflict`,
     * having changed nothing.
     *
     * It polls rather than joining `waiters`, because a release wakes exactly one waiter, and a
     * reinstall that took a wake it could not use would leave a `/speak` asleep that could have run.
     */
    async replace(engineId: string, swap: () => Promise<void>, waitSeconds: number): Promise<void> {
        const deadline = this.clock.now().plus({ seconds: waitSeconds });
        for (;;) {
            const swapped = await this.transition.run(async () => {
                const resident = this.residents.get(engineId);
                if (resident !== undefined && resident.leases > 0) return false;
                resident?.cancelIdle?.();
                this.residents.delete(engineId);
                await swap();
                return true;
            });
            if (swapped) {
                // A slot may have come free, and a request waiting on one should not sleep out its
                // deadline over a model that has already gone.
                this.wake();
                return;
            }
            if (this.clock.now() > deadline) {
                throw new RhapsodeError('conflict', `"${engineId}" was still speaking after ${waitSeconds}s, so it was left as it was`);
            }
            await new Promise<void>(fulfil => this.clock.after(1, async () => fulfil()));
        }
    }

    /**
     * Give this engine's memory back now, rather than waiting out its keep-alive. § 3.
     *
     * Refused while the engine is speaking, for `forget`'s reason: cutting off a stream in progress
     * hands that caller a truncated file for something they could not have predicted. A busy box
     * can therefore refuse this indefinitely, which is the honest answer. Draining instead was
     * considered and left out: the next request may set a new keep-alive, so a promise to unload
     * once the current one ends is one the core cannot keep.
     *
     * Idempotent, like the worker verb it reaches for: an engine holding nothing is already in the
     * state this asks for. `terminate` still ends a process holding no model, because that is how
     * an operator reclaims what a variant switch left stranded.
     */
    async free(engineId: string, mode: 'terminate' | 'unload'): Promise<void> {
        await this.transition.run(async () => {
            const resident = this.residents.get(engineId);
            if (resident !== undefined && resident.leases > 0) {
                throw new RhapsodeError('conflict', `"${engineId}" is speaking; free it once it has finished`);
            }
            if (resident !== undefined) {
                await this.release(resident, mode);
                return;
            }

            // Nothing resident. A terminate still has a process to end; an unload has nothing to do
            // and must not spawn a worker to discover that.
            if (mode === 'terminate') await this.workers.handle(engineId).stop('evict');
        });
    }

    private hold(resident: Resident, wanted: ResidencyRequest): void {
        resident.leases += 1;
        resident.lastUsedAt = this.clock.now();
        // The last request to take a lease wins, and one that says nothing puts the engine's own
        // answer back. Two requests cannot both be right about a model they share, and the newer
        // one is the one whose caller is still waiting.
        resident.keepAliveSeconds = wanted.keepAliveSeconds;
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
        const seconds = this.keepAliveFor(resident);
        if (seconds < 0) return;

        // From the last use rather than from now. The same thing when a request has just let go,
        // which is every call but one: a keep-alive changed while the model sat idle (§ 10), where
        // the model has already spent some of it.
        resident.expiresAt = resident.lastUsedAt.plus({ seconds });
        const remaining = Math.max(0, resident.expiresAt.diff(this.clock.now()).as('seconds'));
        resident.cancelIdle = this.clock.after(remaining, async () => {
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

    /** What the request asked for, then the engine's own answer, then the server's. § 3. */
    private keepAliveFor(resident: Resident): number {
        return resident.keepAliveSeconds ?? this.engines.entry(resident.engineId)?.keepAliveSeconds ?? this.policy.keepAliveSeconds;
    }

    /**
     * Put a new deadline on every model nobody is holding, for a keep-alive changed through
     * `PATCH /settings`. protocol.md § 10.
     *
     * Without it a change reaches only models released after it, and `GET /residency` goes on showing
     * the old deadline for one sitting idle, which reads as a setting that did nothing. A model now
     * past its new deadline goes at once. A model being spoken has no deadline to move, and gets the
     * new one when it is let go.
     */
    async rearmExpiry(): Promise<void> {
        await this.transition.run(async () => {
            for (const resident of this.residents.values()) {
                if (resident.leases > 0) continue;
                resident.cancelIdle?.();
                resident.cancelIdle = undefined;
                resident.expiresAt = undefined;
                this.armExpiry(resident);
            }
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

    /**
     * Every model on the card, for an operator asking where their memory went. § 3.
     *
     * Read from the core's own state only. Asking each worker instead would make listing what is
     * loaded a reason to spawn processes that are not, which is the opposite of what somebody
     * looking at a full card wants.
     */
    models(): ResidentModel[] {
        return [...this.residents.values()]
            .sort((left, right) => left.engineId.localeCompare(right.engineId))
            .map(resident => ({
                engine: resident.engineId,
                variant: resident.variant,
                leases: resident.leases,
                lastUsedAt: resident.lastUsedAt.toISO()!,
                keepAliveSeconds: this.keepAliveFor(resident),
                ...(resident.expiresAt === undefined ? {} : { expiresAt: resident.expiresAt.toISO()! }),
                ...(resident.sizeBytes === undefined ? {} : { sizeBytes: resident.sizeBytes }),
            }));
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
