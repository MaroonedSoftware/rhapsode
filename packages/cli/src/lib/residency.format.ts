import type { ResidentModel } from '@rhapsode/contract';
import { DateTime } from 'luxon';

/**
 * The rows of `wizard ps`, as text.
 *
 * Separate from the command so the formatting can be tested without a server, and because the same
 * columns are what the web page shows. protocol.md § 3.
 */

const UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB'] as const;

/** Binary units, because that is what a card is sold and measured in. */
export const describeSize = (bytes: number | undefined): string => {
    // Absent means the worker could not measure it, which is not the same as zero and must not
    // print as it: § 3 has the worker leave the field out rather than invent a number.
    if (bytes === undefined) return '-';
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < UNITS.length - 1) {
        value /= 1024;
        unit += 1;
    }
    return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${UNITS[unit]}`;
};

export const describeExpiry = (model: ResidentModel, now: DateTime = DateTime.utc()): string => {
    if (model.leases > 0) return `speaking (${model.leases})`;
    if (model.expiresAt === undefined) return 'never';

    const seconds = Math.round(DateTime.fromISO(model.expiresAt).diff(now).as('seconds'));
    if (seconds <= 0) return 'any moment';
    if (seconds < 60) return `in ${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `in ${minutes}m ${seconds % 60}s`;
    return `in ${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

/** One header and a row per model, padded to the widest cell in each column. */
export const table = (models: ResidentModel[], now: DateTime = DateTime.utc()): string[] => {
    const rows = [
        ['ENGINE', 'VARIANT', 'SIZE', 'EXPIRES'],
        ...models.map(model => [model.engine, model.variant, describeSize(model.sizeBytes), describeExpiry(model, now)]),
    ];

    const widths = rows[0]!.map((_, column) => Math.max(...rows.map(row => row[column]!.length)));
    return rows.map(row =>
        row
            .map((cell, column) => (column === row.length - 1 ? cell : cell.padEnd(widths[column]!)))
            .join('  ')
            .trimEnd(),
    );
};
