import { DateTime } from 'luxon';
import { beforeEach, describe, expect, it } from 'vitest';

import type { WorkerHealth } from '@rhapsode/contract';

import { RhapsodeJsonLogger } from '../src/logging/rhapsode.logger.js';
import { EngineRegistry } from '../src/registry/engine.registry.js';
import type { ResidencyClock } from '../src/residency/residency.clock.js';
import { ResidencyManager, type ResidencyPolicy, type ResidentWorkers } from '../src/residency/residency.manager.js';

/**
 * Time the test moves by hand.
 *
 * `advance` awaits what it fires, so a test can assert on the state a timer left behind without
 * polling for it. That is the whole reason `ResidencyClock.after` takes an async callback.
 */
class ManualClock implements ResidencyClock {
    private instant = DateTime.utc().set({ millisecond: 0 });
    private readonly pending = new Set<{ due: DateTime; run: () => Promise<void> }>();

    now(): DateTime {
        return this.instant;
    }

    after(seconds: number, run: () => Promise<void>): () => void {
        const entry = { due: this.instant.plus({ seconds }), run };
        this.pending.add(entry);
        return () => this.pending.delete(entry);
    }

    /** Move time on, running whatever that makes due, oldest first. */
    async advance(seconds: number): Promise<void> {
        this.instant = this.instant.plus({ seconds });
        for (;;) {
            const due = [...this.pending]
                .filter(entry => entry.due <= this.instant)
                .sort((left, right) => left.due.toMillis() - right.due.toMillis())[0];
            if (due === undefined) return;
            this.pending.delete(due);
            await due.run();
        }
    }

    /**
     * The callbacks a jump of this many seconds would fire, taken without firing them.
     *
     * Holding one and running it later is how a test reproduces a timer already on its way when
     * something cancelled it, which is the one case cancelling cannot cover.
     */
    due(seconds: number): (() => Promise<void>)[] {
        const at = this.instant.plus({ seconds });
        return [...this.pending].filter(entry => entry.due <= at).map(entry => entry.run);
    }

    get armed(): number {
        return this.pending.size;
    }
}

type Call = `${string}:${'load' | 'unload' | 'stop'}${string}`;

class FakeWorkers implements ResidentWorkers {
    readonly calls: Call[] = [];
    failNextLoad: string | undefined;
    /** What a worker reports the load cost, or nothing where it could not measure. */
    modelBytes: number | undefined;

    async client(id: string) {
        return {
            load: async (variant?: string): Promise<WorkerHealth> => {
                this.calls.push(`${id}:load:${variant ?? ''}`);
                const failure = this.failNextLoad;
                if (failure !== undefined) {
                    this.failNextLoad = undefined;
                    throw new Error(failure);
                }
                return {
                    process: 'up',
                    model: 'loaded',
                    ...(variant === undefined ? {} : { variant }),
                    ...(this.modelBytes === undefined ? {} : { modelBytes: this.modelBytes }),
                };
            },
            unload: async (): Promise<WorkerHealth> => {
                this.calls.push(`${id}:unload`);
                return { process: 'up', model: 'unloaded' };
            },
        };
    }

    handle(id: string) {
        return {
            stop: async (reason: 'shutdown' | 'evict' | 'uninstall'): Promise<void> => {
                this.calls.push(`${id}:stop:${reason}`);
            },
        };
    }
}

const silent = () => new RhapsodeJsonLogger('error', () => {});

const MIT = { code: 'MIT', weights: 'MIT', weightsCommercialUse: true };

/**
 * Let a queued acquire reach its wait, which is several microtasks past the call.
 *
 * Advancing a hand-driven clock before the waiter has armed fires nothing, so without this the
 * queueing tests assert on a queue that has not formed yet.
 */
const settle = () => new Promise<void>(fulfil => setImmediate(fulfil));

describe('the residency manager', () => {
    let clock: ManualClock;
    let workers: FakeWorkers;
    let engines: EngineRegistry;

    /** Keep-alive off unless a test is about the keep-alive, so nothing else expires mid-assertion. */
    const build = (policy: Partial<ResidencyPolicy> = {}) =>
        new ResidencyManager(workers, engines, silent(), { maxResidentModels: 1, evictionWaitSeconds: 30, keepAliveSeconds: -1, ...policy }, clock);

    beforeEach(() => {
        clock = new ManualClock();
        workers = new FakeWorkers();
        engines = new EngineRegistry();
    });

    it('loads once for two concurrent acquires of the same cold model', async () => {
        const residency = build();

        const [first, second] = await Promise.all([residency.acquire('tone', 'fast'), residency.acquire('tone', 'fast')]);

        expect(workers.calls).toEqual(['tone:load:fast']);
        expect(residency.summary()).toMatchObject({ resident: 1, max: 1 });
        first.release();
        second.release();
    });

    it('reports the model loaded, and unloaded again once it goes', async () => {
        const residency = build();

        const lease = await residency.acquire('tone', 'fast');
        expect(engines.state('tone')).toMatchObject({ model: 'loaded', variant: 'fast' });

        lease.release();
        await residency.forget('tone', async () => {});
        expect(residency.summary().resident).toBe(0);
    });

    it('leaves nothing resident when the load fails', async () => {
        const residency = build();
        workers.failNextLoad = 'no weights';

        await expect(residency.acquire('tone', 'fast')).rejects.toThrow('no weights');
        expect(residency.summary().resident).toBe(0);
        expect(engines.state('tone')).toMatchObject({ model: 'unloaded', variant: undefined });
    });

    it('terminates the least recently used model to make room', async () => {
        const residency = build({ maxResidentModels: 2 });

        (await residency.acquire('tone', 'fast')).release();
        await clock.advance(1);
        (await residency.acquire('piper', 'fast')).release();
        await clock.advance(1);

        const lease = await residency.acquire('kokoro', 'fast');

        // Terminate rather than unload: an eviction exists to get the card back, and an unload
        // leaves roughly 30% stranded. § 3.
        expect(workers.calls).toContain('tone:stop:evict');
        expect(workers.calls).not.toContain('piper:stop:evict');
        lease.release();
    });

    it('unloads rather than terminates when the same engine changes variant', async () => {
        const residency = build();

        (await residency.acquire('tone', 'fast')).release();
        const lease = await residency.acquire('tone', 'slow');

        expect(workers.calls).toEqual(['tone:load:fast', 'tone:unload', 'tone:load:slow']);
        lease.release();
    });

    it('queues behind a model that is speaking rather than evicting it', async () => {
        const residency = build();

        const speaking = await residency.acquire('tone', 'fast');
        const queued = residency.acquire('piper', 'fast');

        await settle();
        expect(residency.waiting).toBe(1);
        expect(workers.calls).toEqual(['tone:load:fast']);

        speaking.release();
        const lease = await queued;
        expect(workers.calls).toEqual(['tone:load:fast', 'tone:stop:evict', 'piper:load:fast']);
        lease.release();
    });

    it('refuses once it has waited out the eviction budget', async () => {
        const residency = build({ evictionWaitSeconds: 30 });

        const speaking = await residency.acquire('tone', 'fast');
        const queued = residency.acquire('piper', 'fast');

        await settle();
        await clock.advance(31);

        await expect(queued).rejects.toThrow(/waited 30s for a slot and tone is still speaking/);
        speaking.release();
    });

    it('counts a lease once however many times it is released', async () => {
        // A double release lets the next request evict a model that is still speaking, which is why
        // the flag on the lease is not optional.
        const residency = build();

        const first = await residency.acquire('tone', 'fast');
        const second = await residency.acquire('tone', 'fast');
        first.release();
        first.release();

        const queued = residency.acquire('piper', 'fast');
        await settle();
        expect(residency.waiting).toBe(1);

        second.release();
        (await queued).release();
    });

    describe('the keep-alive', () => {
        it('terminates a model that has been idle for its keep-alive', async () => {
            const residency = build({ keepAliveSeconds: 300 });

            (await residency.acquire('tone', 'fast')).release();
            await clock.advance(299);
            expect(residency.summary().resident).toBe(1);

            await clock.advance(1);
            // Terminate, not unload: an unload leaves roughly 30% stranded, and an expiry that ran
            // every five minutes would give a card away 30% at a time. § 3.
            expect(workers.calls).toContain('tone:stop:evict');
            expect(workers.calls).not.toContain('tone:unload');
            expect(residency.summary().resident).toBe(0);
            expect(engines.state('tone')).toMatchObject({ model: 'unloaded' });
        });

        it('keeps a model for good when the keep-alive says never', async () => {
            const residency = build({ keepAliveSeconds: -1 });

            (await residency.acquire('tone', 'fast')).release();

            expect(clock.armed).toBe(0);
            await clock.advance(86_400);
            expect(residency.summary().resident).toBe(1);
        });

        it('lets an engine that is expensive to load keep its model longer than the rest', async () => {
            const residency = build({ keepAliveSeconds: 60 });
            engines.declare({ id: 'tone', displayName: 'Tone', license: MIT, keepAliveSeconds: 600 });

            (await residency.acquire('tone', 'fast')).release();
            await clock.advance(60);
            expect(residency.summary().resident).toBe(1);

            await clock.advance(540);
            expect(workers.calls).toContain('tone:stop:evict');
        });

        it('lets a request outrank the engine and the server', async () => {
            const residency = build({ keepAliveSeconds: 600 });
            engines.declare({ id: 'tone', displayName: 'Tone', license: MIT, keepAliveSeconds: 300 });

            (await residency.acquire('tone', 'fast', { keepAliveSeconds: 30 })).release();
            await clock.advance(30);

            expect(workers.calls).toContain('tone:stop:evict');
        });

        it('lets the last request to ask win, which is the only one still waiting', async () => {
            const residency = build({ keepAliveSeconds: 600 });

            const first = await residency.acquire('tone', 'fast', { keepAliveSeconds: -1 });
            const second = await residency.acquire('tone', 'fast', { keepAliveSeconds: 30 });
            first.release();
            second.release();

            await clock.advance(30);
            expect(workers.calls).toContain('tone:stop:evict');
        });

        it('puts the engine’s own answer back when a request says nothing', async () => {
            const residency = build({ keepAliveSeconds: 600 });
            engines.declare({ id: 'tone', displayName: 'Tone', license: MIT, keepAliveSeconds: 60 });

            (await residency.acquire('tone', 'fast', { keepAliveSeconds: 5 })).release();
            await clock.advance(4);
            (await residency.acquire('tone', 'fast')).release();

            await clock.advance(1);
            expect(residency.summary().resident).toBe(1);
            await clock.advance(59);
            expect(workers.calls).toContain('tone:stop:evict');
        });

        it('frees a model at zero only once every request has let go', async () => {
            const residency = build({ keepAliveSeconds: -1 });

            const first = await residency.acquire('tone', 'fast', { keepAliveSeconds: 0 });
            const second = await residency.acquire('tone', 'fast', { keepAliveSeconds: 0 });

            first.release();
            await clock.advance(0);
            expect(residency.summary().resident).toBe(1);

            second.release();
            await clock.advance(0);
            expect(residency.summary().resident).toBe(0);
        });

        it('lets an engine pin its model against a server-wide deadline', async () => {
            const residency = build({ keepAliveSeconds: 60 });
            engines.declare({ id: 'tone', displayName: 'Tone', license: MIT, keepAliveSeconds: -1 });

            (await residency.acquire('tone', 'fast')).release();

            expect(clock.armed).toBe(0);
            await clock.advance(86_400);
            expect(residency.summary().resident).toBe(1);
        });

        it('frees a model as soon as the last request lets go, at zero', async () => {
            const residency = build({ keepAliveSeconds: 0 });

            const first = await residency.acquire('tone', 'fast');
            const second = await residency.acquire('tone', 'fast');

            first.release();
            await clock.advance(0);
            expect(residency.summary().resident).toBe(1);

            second.release();
            await clock.advance(0);
            expect(workers.calls).toContain('tone:stop:evict');
            expect(residency.summary().resident).toBe(0);
        });

        it('disarms while the model is speaking again', async () => {
            const residency = build({ keepAliveSeconds: 60 });

            (await residency.acquire('tone', 'fast')).release();
            const speaking = await residency.acquire('tone', 'fast');
            await clock.advance(60);

            expect(workers.calls).toEqual(['tone:load:fast']);
            expect(residency.summary().resident).toBe(1);
            speaking.release();
        });

        it('spares a model that was used again while its expiry was already on its way', async () => {
            // Cancelling covers the model picked up again in time; it cannot recall a callback
            // already dispatched. Without the deadline check that callback terminates a model used
            // a millisecond ago, and at five minutes by default this is a race that would run all
            // day on a busy box.
            const residency = build({ keepAliveSeconds: 60 });

            (await residency.acquire('tone', 'fast')).release();
            await clock.advance(59);

            // The expiry is a second away and about to fire when the model is asked for again.
            const dispatched = clock.due(1);
            expect(dispatched).toHaveLength(1);
            (await residency.acquire('tone', 'fast')).release();

            await clock.advance(1);
            await Promise.all(dispatched.map(run => run()));

            expect(residency.summary().resident).toBe(1);
            expect(workers.calls).toEqual(['tone:load:fast']);
        });

        it('drops every expiry when the core is going down', async () => {
            const residency = build({ keepAliveSeconds: 60 });

            (await residency.acquire('tone', 'fast')).release();
            residency.stopExpiry();

            expect(clock.armed).toBe(0);
            await clock.advance(600);
            expect(workers.calls).toEqual(['tone:load:fast']);
        });
    });

    describe('what is on the card', () => {
        it('lists a resident with its expiry, and keeps the size the worker measured', async () => {
            const residency = build({ keepAliveSeconds: 60 });
            workers.modelBytes = 3_355_443_200;

            const speaking = await residency.acquire('tone', 'fast');

            // No expiry while it is speaking: the deadline starts when the last request lets go.
            expect(residency.models()).toEqual([
                {
                    engine: 'tone',
                    variant: 'fast',
                    leases: 1,
                    lastUsedAt: clock.now().toISO(),
                    keepAliveSeconds: 60,
                    sizeBytes: 3_355_443_200,
                },
            ]);

            speaking.release();
            expect(residency.models()[0]!.expiresAt).toBe(clock.now().plus({ seconds: 60 }).toISO());
        });

        it('leaves the size out when the worker could not measure one', async () => {
            const residency = build();
            (await residency.acquire('tone', 'fast')).release();

            expect(residency.models()[0]).not.toHaveProperty('sizeBytes');
        });

        it('has no expiry for a model that never expires', async () => {
            const residency = build({ keepAliveSeconds: -1 });
            (await residency.acquire('tone', 'fast')).release();

            expect(residency.models()[0]).toMatchObject({ keepAliveSeconds: -1 });
            expect(residency.models()[0]).not.toHaveProperty('expiresAt');
        });

        it('reports the keep-alive actually in force, not the server default', async () => {
            const residency = build({ keepAliveSeconds: 600 });
            engines.declare({ id: 'tone', displayName: 'Tone', license: MIT, keepAliveSeconds: 120 });

            (await residency.acquire('tone', 'fast')).release();
            expect(residency.models()[0]).toMatchObject({ keepAliveSeconds: 120 });

            (await residency.acquire('tone', 'fast', { keepAliveSeconds: 5 })).release();
            expect(residency.models()[0]).toMatchObject({ keepAliveSeconds: 5 });
        });

        it('is empty once the last model has gone', async () => {
            const residency = build({ keepAliveSeconds: 30 });

            (await residency.acquire('tone', 'fast')).release();
            expect(residency.models()).toHaveLength(1);

            await clock.advance(30);
            expect(residency.models()).toEqual([]);
        });
    });

    describe('forget', () => {
        it('runs the removal while nothing can load the engine', async () => {
            const residency = build();
            (await residency.acquire('tone', 'fast')).release();

            let removed = false;
            await residency.forget('tone', async () => {
                removed = true;
            });

            expect(removed).toBe(true);
            expect(residency.summary().resident).toBe(0);
        });

        it('refuses while the engine is speaking, rather than truncating the stream', async () => {
            const residency = build();
            const speaking = await residency.acquire('tone', 'fast');

            await expect(residency.forget('tone', async () => {})).rejects.toThrow(/is speaking/);
            speaking.release();
        });
    });
});
