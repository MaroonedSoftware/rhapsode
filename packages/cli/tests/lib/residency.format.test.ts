import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';

import type { ResidentModel } from '@rhapsode/contract';

import { describeExpiry, describeSize, table } from '../../src/lib/residency.format.js';

const now = DateTime.fromISO('2026-09-20T11:00:00.000Z', { zone: 'utc' });

const model = (over: Partial<ResidentModel> = {}): ResidentModel => ({
    engine: 'tone',
    variant: 'plain',
    leases: 0,
    lastUsedAt: now.toISO()!,
    keepAliveSeconds: 300,
    ...over,
});

describe('a size', () => {
    it('is in the units a card is sold in', () => {
        expect(describeSize(3_355_443_200)).toBe('3.1 GiB');
        expect(describeSize(64 * 1024 * 1024)).toBe('64.0 MiB');
        expect(describeSize(512)).toBe('512 B');
    });

    it('is a dash when nothing measured it, which is not the same as zero', () => {
        // § 3 has a worker leave the field out rather than report 0, and printing "0 B" here would
        // put the invented number back.
        expect(describeSize(undefined)).toBe('-');
    });
});

describe('an expiry', () => {
    it('counts down', () => {
        expect(describeExpiry(model({ expiresAt: now.plus({ seconds: 42 }).toISO()! }), now)).toBe('in 42s');
        expect(describeExpiry(model({ expiresAt: now.plus({ minutes: 4, seconds: 32 }).toISO()! }), now)).toBe('in 4m 32s');
        expect(describeExpiry(model({ expiresAt: now.plus({ hours: 2, minutes: 5 }).toISO()! }), now)).toBe('in 2h 5m');
    });

    it('says never when the model has no deadline', () => {
        expect(describeExpiry(model({ keepAliveSeconds: -1 }), now)).toBe('never');
    });

    it('says what is holding it while it is speaking', () => {
        // A model with leases is one nothing can evict yet, and its deadline has not started.
        expect(describeExpiry(model({ leases: 2 }), now)).toBe('speaking (2)');
    });

    it('does not print a negative countdown for a timer that is about to fire', () => {
        expect(describeExpiry(model({ expiresAt: now.minus({ seconds: 3 }).toISO()! }), now)).toBe('any moment');
    });
});

describe('the table', () => {
    it('lines the columns up under their headers', () => {
        const lines = table(
            [
                model({ engine: 'tone', sizeBytes: undefined, expiresAt: now.plus({ minutes: 5 }).toISO()! }),
                model({ engine: 'chatterbox', variant: 'turbo', sizeBytes: 3_355_443_200, leases: 1 }),
            ],
            now,
        );

        expect(lines).toEqual([
            'ENGINE      VARIANT  SIZE     EXPIRES',
            'tone        plain    -        in 5m 0s',
            'chatterbox  turbo    3.1 GiB  speaking (1)',
        ]);
    });

    it('is just the header when nothing is loaded', () => {
        expect(table([], now)).toEqual(['ENGINE  VARIANT  SIZE  EXPIRES']);
    });
});
