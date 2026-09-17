import { describe, expect, it } from 'vitest';

import { Mutex } from '../src/residency/mutex.js';

describe('the transition lock', () => {
    it('runs one at a time, in order', async () => {
        const mutex = new Mutex();
        const order: number[] = [];

        await Promise.all(
            [3, 1, 2].map((delay, index) =>
                mutex.run(async () => {
                    await new Promise(fulfil => setTimeout(fulfil, delay));
                    order.push(index);
                }),
            ),
        );

        expect(order).toEqual([0, 1, 2]);
    });

    it('collapses concurrent work on the same thing into one', async () => {
        // Two concurrent requests for the same cold model must produce one load, not two. That is
        // the whole reason this exists.
        const mutex = new Mutex();
        let loads = 0;
        let loaded = false;

        const load = () =>
            mutex.run(async () => {
                if (loaded) return;
                loads += 1;
                await new Promise(fulfil => setTimeout(fulfil, 5));
                loaded = true;
            });

        await Promise.all([load(), load(), load()]);
        expect(loads).toBe(1);
    });

    it('releases when the work throws, or everything after it deadlocks', async () => {
        const mutex = new Mutex();
        await expect(mutex.run(async () => Promise.reject(new Error('nope')))).rejects.toThrow('nope');
        await expect(mutex.run(async () => 'fine')).resolves.toBe('fine');
    });
});
