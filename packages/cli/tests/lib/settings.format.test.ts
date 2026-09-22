import { describe, expect, it } from 'vitest';

import type { Settings } from '@rhapsode/contract';

import { describeValue, patchFor, table, waitingNote } from '../../src/lib/settings.format.js';

const settings = (overrides: Partial<Settings> = {}): Settings => ({
    values: {
        server: { port: 8080, host: '::', shutdownGraceMs: 20000 },
        log: { level: 'info' },
        residency: { maxResidentModels: 1, evictionWaitSeconds: 30, keepAliveSeconds: 300 },
        workers: {
            socketDir: '/run/rhapsode',
            voiceDir: '/v',
            startupTimeoutSeconds: 60,
            drainGraceMs: 10000,
            maxRestarts: 5,
            restartDecaySeconds: 300,
        },
        install: { venvDir: '/venvs', python: 'python3' },
        management: { tokenSet: true, origins: [] },
        update: { check: true },
        engines: { kokoro: { keepAliveSeconds: 900 } },
    },
    fields: [
        { key: 'server.port', source: 'default', applies: 'restart' },
        { key: 'residency.keepAliveSeconds', source: 'config', applies: 'live' },
        { key: 'install.sourceDir', source: 'default', applies: 'restart' },
        { key: 'management.token', source: 'database', applies: 'restart' },
        { key: 'management.origins', source: 'default', applies: 'restart' },
        { key: 'update.check', source: 'default', applies: 'live' },
        { key: 'engines.kokoro.keepAliveSeconds', source: 'database', applies: 'live' },
    ],
    ...overrides,
});

describe('the table', () => {
    it('shows where each value came from and when a change to it applies, without a waiting column when nothing waits', () => {
        const lines = table(settings());

        expect(lines[0]).toBe('KEY                              VALUE   FROM      APPLIES');
        expect(lines).toContain('residency.keepAliveSeconds       300     config    now');
        expect(lines).toContain('engines.kokoro.keepAliveSeconds  900     database  now');
        expect(waitingNote(settings())).toBeUndefined();
    });

    it('says a token is set, and never anything more about it, waiting or not', () => {
        const waiting = settings();
        waiting.fields = waiting.fields.map(field => (field.key === 'management.token' ? { ...field, saved: true } : field));

        expect(describeValue(waiting, 'management.token')).toBe('set');
        expect(table(waiting).find(line => line.startsWith('management.token'))).toMatch(/set\s+database\s+restart\s+a new token$/);
    });

    it('adds a waiting column, and says how many changes wait, when any does', () => {
        const waiting = settings();
        waiting.fields = waiting.fields.map(field => (field.key === 'server.port' ? { ...field, saved: 9100 } : field));

        expect(table(waiting)[0]).toMatch(/WAITING$/);
        expect(table(waiting).find(line => line.startsWith('server.port'))).toMatch(/8080\s+default\s+restart\s+9100$/);
        expect(waitingNote(waiting)).toBe('1 change takes effect when rhapsode restarts.');
    });

    it('prints an empty list and a missing value so neither reads as a blank', () => {
        expect(describeValue(settings(), 'management.origins')).toBe('(none)');
        expect(describeValue(settings(), 'install.sourceDir')).toBe('-');
    });
});

describe('a change to one setting', () => {
    it('reads the value as the kind the setting already has', () => {
        expect(patchFor(settings(), 'server.port', '9000')).toEqual({ server: { port: 9000 } });
        expect(patchFor(settings(), 'update.check', 'off')).toEqual({ update: { check: false } });
        expect(patchFor(settings(), 'management.origins', 'http://tower:8081, http://nas:8081')).toEqual({
            management: { origins: ['http://tower:8081', 'http://nas:8081'] },
        });
        expect(patchFor(settings(), 'management.origins', '')).toEqual({ management: { origins: [] } });
        expect(patchFor(settings(), 'engines.kokoro.keepAliveSeconds', '-1')).toEqual({ engines: { kokoro: { keepAliveSeconds: -1 } } });
    });

    it('sends a setting with no value yet as typed, since the only such settings are paths', () => {
        expect(patchFor(settings(), 'install.sourceDir', '/src/python')).toEqual({ install: { sourceDir: '/src/python' } });
    });

    it('clears with null, and sends nothing for a key without a value', () => {
        expect(patchFor(settings(), 'residency.keepAliveSeconds', null)).toEqual({ residency: { keepAliveSeconds: null } });
        expect(patchFor(settings(), 'residency.keepAliveSeconds', undefined)).toBeUndefined();
    });

    it('refuses a value that is not the kind the setting takes, before asking the server', () => {
        expect(() => patchFor(settings(), 'server.port', 'lots')).toThrow('server.port is a number, and "lots" is not one');
        expect(() => patchFor(settings(), 'server.port', ' ')).toThrow(/is a number/);
        expect(() => patchFor(settings(), 'update.check', 'maybe')).toThrow('update.check is true or false');
    });

    it('names every setting there is when the key is not one', () => {
        expect(() => patchFor(settings(), 'residency.keepAliveSecs', '5')).toThrow(/no setting called residency.keepAliveSecs.*server.port/);
    });
});
