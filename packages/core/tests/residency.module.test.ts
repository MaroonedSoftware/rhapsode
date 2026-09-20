import { describe, expect, it } from 'vitest';

import { DEFAULTS } from '../src/config.js';
import { RhapsodeJsonLogger } from '../src/logging/rhapsode.logger.js';
import { keepAliveFrom } from '../src/residency/residency.module.js';

const warnings = () => {
    const lines: Record<string, unknown>[] = [];
    const logger = new RhapsodeJsonLogger('warn', line => lines.push(JSON.parse(line) as Record<string, unknown>));
    return { logger, lines };
};

describe('the keep-alive an operator ends up with', () => {
    it('is five minutes when nothing says otherwise', () => {
        const { logger, lines } = warnings();
        expect(keepAliveFrom({}, logger)).toBe(DEFAULTS.keepAliveSeconds);
        expect(DEFAULTS.keepAliveSeconds).toBe(300);
        expect(lines).toHaveLength(0);
    });

    it('is whatever the setting says, zero and never included', () => {
        const { logger } = warnings();
        expect(keepAliveFrom({ residency: { keepAliveSeconds: 0 } }, logger)).toBe(0);
        expect(keepAliveFrom({ residency: { keepAliveSeconds: -1 } }, logger)).toBe(-1);
        expect(keepAliveFrom({ residency: { keepAliveSeconds: 30 } }, logger)).toBe(30);
    });

    it('reads the old names, and says which one it read', () => {
        const { logger, lines } = warnings();

        expect(keepAliveFrom({ residency: { idleTerminateSeconds: 120 } }, logger)).toBe(120);

        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatchObject({ setting: 'idleTerminateSeconds', keepAliveSeconds: 120 });
    });

    it('prefers the terminate deadline, which is the verb an expiry now uses anyway', () => {
        const { logger } = warnings();
        expect(keepAliveFrom({ residency: { idleUnloadSeconds: 60, idleTerminateSeconds: 120 } }, logger)).toBe(120);
    });

    it('lets the new name win over both old ones without a word', () => {
        const { logger, lines } = warnings();
        expect(keepAliveFrom({ residency: { keepAliveSeconds: 45, idleUnloadSeconds: 60, idleTerminateSeconds: 120 } }, logger)).toBe(45);
        expect(lines).toHaveLength(0);
    });

    it('treats null as absent, because the documented sample had null in it', () => {
        // An operator who copied the old sample gets the new default rather than a crash, which is
        // the behaviour change the changeset has to be loud about: null used to mean off.
        const { logger, lines } = warnings();
        const settings = { residency: { idleUnloadSeconds: null, idleTerminateSeconds: null } } as never;

        expect(keepAliveFrom(settings, logger)).toBe(DEFAULTS.keepAliveSeconds);
        expect(lines).toHaveLength(0);
    });
});
