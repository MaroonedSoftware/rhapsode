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

    get armed(): number {
        return this.pending.size;
    }
}

type Call = `${string}:${'load' | 'unload' | 'stop'}${string}`;

class FakeWorkers implements ResidentWorkers {
    readonly calls: Call[] = [];
    failNextLoad: string | undefined;

    async client(id: string) {
        return {
            load: async (variant?: string): Promise<WorkerHealth> => {
                this.calls.push(`${id}:load:${variant ?? ''}`);
                const failure = this.failNextLoad;
                if (failure !== undefined) {
                    this.failNextLoad = undefined;
                    throw new Error(failure);
                }
                return { process: 'up', model: 'loaded', ...(variant === undefined ? {} : { variant }) };
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

    const build = (policy: Partial<ResidencyPolicy> = {}) =>
        new ResidencyManager(workers, engines, silent(), { maxResidentModels: 1, evictionWaitSeconds: 30, ...policy }, clock);

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

    describe('idle timers', () => {
        it('unloads an idle model when only the unload deadline is set', async () => {
            const residency = build({ idleUnloadSeconds: 60 });

            (await residency.acquire('tone', 'fast')).release();
            await clock.advance(59);
            expect(residency.summary().resident).toBe(1);

            await clock.advance(1);
            expect(workers.calls).toContain('tone:unload');
            expect(residency.summary().resident).toBe(0);
        });

        it('prefers the terminate deadline when it comes first', async () => {
            const residency = build({ idleUnloadSeconds: 120, idleTerminateSeconds: 60 });

            (await residency.acquire('tone', 'fast')).release();
            await clock.advance(60);

            expect(workers.calls).toContain('tone:stop:evict');
            expect(workers.calls).not.toContain('tone:unload');
        });

        it('arms nothing when neither deadline is set', async () => {
            const residency = build();

            (await residency.acquire('tone', 'fast')).release();

            expect(clock.armed).toBe(0);
            await clock.advance(3600);
            expect(residency.summary().resident).toBe(1);
        });

        it('disarms while the model is speaking again', async () => {
            const residency = build({ idleUnloadSeconds: 60 });

            (await residency.acquire('tone', 'fast')).release();
            const speaking = await residency.acquire('tone', 'fast');
            await clock.advance(60);

            expect(workers.calls).toEqual(['tone:load:fast']);
            expect(residency.summary().resident).toBe(1);
            speaking.release();
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
