import type { Settings, SettingsPatch } from '@rhapsode/contract';

/**
 * `wizard settings` as text, and the patch a change to one setting sends.
 *
 * Separate from the command so both can be tested without a server. Nothing here decides what a
 * setting may be: the server refuses a value it will not take, in words written for a person, and the
 * wizard prints them. protocol.md § 10, "Settings".
 */

/** A dotted key's value in a document, or `undefined` where any step of it is missing. */
export const valueAt = (document: unknown, key: string): unknown =>
    key
        .split('.')
        .reduce<unknown>((at, step) => (at !== null && typeof at === 'object' ? (at as Record<string, unknown>)[step] : undefined), document);

/** How a value reads in the table. The token is never in the document, only whether there is one. */
export const describeValue = (settings: Settings, key: string): string => {
    if (key === 'management.token') return settings.values.management.tokenSet ? 'set' : 'not set';
    return describe(valueAt(settings.values, key));
};

const describe = (value: unknown): string => {
    if (value === undefined || value === null) return '-';
    if (Array.isArray(value)) return value.length === 0 ? '(none)' : value.join(', ');
    return String(value);
};

/** One header and a row per setting; a WAITING column only when something is waiting for a restart. */
export const table = (settings: Settings): string[] => {
    const waiting = settings.fields.some(field => field.saved !== undefined);
    const header = ['KEY', 'VALUE', 'FROM', 'APPLIES', ...(waiting ? ['WAITING'] : [])];
    const rows = [
        header,
        ...settings.fields.map(field => [
            field.key,
            describeValue(settings, field.key),
            field.source,
            field.applies === 'live' ? 'now' : 'restart',
            // The token's saved is `true`, never the token: say that one is waiting, and nothing more.
            ...(waiting ? [field.saved === undefined ? '' : field.key === 'management.token' ? 'a new token' : describe(field.saved)] : []),
        ]),
    ];

    const widths = header.map((_, column) => Math.max(...rows.map(row => row[column]!.length)));
    return rows.map(row =>
        row
            .map((cell, column) => (column === row.length - 1 ? cell : cell.padEnd(widths[column]!)))
            .join('  ')
            .trimEnd(),
    );
};

/** How many changes wait for a restart, as a sentence, or nothing when none do. */
export const waitingNote = (settings: Settings): string | undefined => {
    const count = settings.fields.filter(field => field.saved !== undefined).length;
    if (count === 0) return undefined;
    return `${count} change${count === 1 ? '' : 's'} take${count === 1 ? 's' : ''} effect when rhapsode restarts.`;
};

/**
 * The patch that sets one setting to what was typed, read as the kind of value the setting already
 * has: a number stays a number and a list stays a list. A setting the document has no value for,
 * which is only ever a string (`install.sourceDir` without a checkout), is sent as typed.
 *
 * `null` clears the setting, which is `--unset`. `undefined`, a key with no value, is no patch at all.
 */
export function patchFor(settings: Settings, key: string, typed: string | null | undefined): SettingsPatch | undefined {
    if (!settings.fields.some(field => field.key === key)) {
        const known = settings.fields.map(field => field.key).join(', ');
        throw new Error(`there is no setting called ${key}. The settings are: ${known}`);
    }
    if (typed === undefined) return undefined;
    return nest(key, typed === null ? null : parse(key, valueAt(settings.values, key), typed));
}

function parse(key: string, current: unknown, typed: string): unknown {
    if (typeof current === 'number') {
        const number = Number(typed);
        if (typed.trim() === '' || !Number.isFinite(number)) throw new Error(`${key} is a number, and "${typed}" is not one`);
        return number;
    }
    if (typeof current === 'boolean') {
        if (/^(true|on|yes|1)$/i.test(typed)) return true;
        if (/^(false|off|no|0)$/i.test(typed)) return false;
        throw new Error(`${key} is true or false, and "${typed}" is neither`);
    }
    // Commas, since that is how the table prints a list. An empty value is the empty list.
    if (Array.isArray(current)) {
        return typed
            .split(',')
            .map(item => item.trim())
            .filter(item => item !== '');
    }
    return typed;
}

/** `residency.keepAliveSeconds` and 60 as `{ residency: { keepAliveSeconds: 60 } }`. */
function nest(key: string, value: unknown): SettingsPatch {
    const steps = key.split('.');
    let patch: unknown = value;
    for (const step of steps.reverse()) patch = { [step]: patch };
    return patch as SettingsPatch;
}
