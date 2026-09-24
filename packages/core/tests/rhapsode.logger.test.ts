import { describe, expect, it } from 'vitest';

import { RhapsodeJsonLogger } from '../src/logging/rhapsode.logger.js';

function capture() {
    const lines: Record<string, unknown>[] = [];
    const logger = new RhapsodeJsonLogger('debug', line => lines.push(JSON.parse(line) as Record<string, unknown>));
    return { logger, lines };
}

describe('RhapsodeJsonLogger', () => {
    it('spreads an object field into the record and keeps a reserved key under a suffix', () => {
        const { logger, lines } = capture();
        logger.info('started', { engine: 'tone', message: 'the caller’s own' });

        expect(lines[0]).toMatchObject({ level: 'info', message: 'started', engine: 'tone', message_: 'the caller’s own' });
    });

    it('keeps every field that is not an object, in order, under extra', () => {
        // A string or a number passed as a field has no key to spread under, and dropping it would
        // be the logger losing what it was asked to write.
        const { logger, lines } = capture();
        logger.warn('odd', 'first', 2, ['third']);

        expect(lines[0]).toMatchObject({ level: 'warn', message: 'odd', extra: ['first', 2, ['third']] });
    });

    it('writes an error with its cause, not as [object Object]', () => {
        const { logger, lines } = capture();
        logger.error('failed', new Error('outer', { cause: new Error('inner') }));

        expect(lines[0]!.extra).toMatchObject([{ name: 'Error', message: 'outer', cause: { message: 'inner' } }]);
    });
});
