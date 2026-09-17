import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';

/**
 * One JSON object per line on stdout. ServerKit ships only a `ConsoleLogger`, deliberately: its
 * logger package is contractually dependency-free, so anything structured is the app's to provide.
 *
 * The shape matches what a worker writes to its own stderr, so a log line from the core and a log
 * line forwarded from a worker read the same way and can be filtered by the same query.
 */
@Injectable()
export class RhapsodeJsonLogger extends Logger {
    constructor(
        private readonly level: LogLevel = 'info',
        private readonly write: (line: string) => void = line => process.stdout.write(`${line}\n`),
    ) {
        super();
    }

    error(message: unknown, ...fields: unknown[]): void {
        this.emit('error', message, fields);
    }

    warn(message: unknown, ...fields: unknown[]): void {
        this.emit('warn', message, fields);
    }

    info(message: unknown, ...fields: unknown[]): void {
        this.emit('info', message, fields);
    }

    debug(message: unknown, ...fields: unknown[]): void {
        this.emit('debug', message, fields);
    }

    trace(message: unknown, ...fields: unknown[]): void {
        this.emit('trace', message, fields);
    }

    private emit(level: LogLevel, message: unknown, fields: unknown[]): void {
        if (LEVELS.indexOf(level) > LEVELS.indexOf(this.level)) return;

        const record: Record<string, unknown> = {};
        for (const field of fields) {
            if (field !== null && typeof field === 'object' && !Array.isArray(field)) {
                for (const [key, value] of Object.entries(field)) {
                    // The record's own keys are authoritative, and a collision is kept under a
                    // suffixed name rather than dropped: a caller passing `message` meant something
                    // by it, and a logger that loses what it was asked to write is worse than one
                    // that renames a field.
                    record[RESERVED.has(key) ? `${key}_` : key] = serialise(value);
                }
            } else if (field !== undefined) {
                (record.extra ??= []) && (record.extra as unknown[]).push(serialise(field));
            }
        }

        record.level = level;
        record.message = typeof message === 'string' ? message : serialise(message);
        record.time = new Date().toISOString();

        try {
            this.write(JSON.stringify(record));
        } catch {
            this.write(JSON.stringify({ level, message: String(record.message), time: record.time }));
        }
    }
}

export type LogLevel = (typeof LEVELS)[number];

export const LEVELS = ['error', 'warn', 'info', 'debug', 'trace'] as const;

const RESERVED = new Set(['level', 'message', 'time']);

/**
 * An `Error` becomes something a reader can act on.
 *
 * `String(error)` destroys a cause and an object becomes `[object Object]`, which is the trap a
 * hand-rolled logger falls into once and then never notices again.
 */
function serialise(value: unknown): unknown {
    if (value instanceof Error) {
        return {
            name: value.name,
            message: value.message,
            stack: value.stack,
            ...(value.cause === undefined ? {} : { cause: serialise(value.cause) }),
        };
    }
    if (typeof value === 'bigint') return value.toString();
    return value;
}
