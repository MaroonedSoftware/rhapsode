import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { configPath, displayPath } from '../../src/lib/paths.js';
import { localEngines, readConfig, renderConfig, starterConfig } from '../../src/lib/rhapsode.config.js';

const scratch = (): string => mkdtempSync(join(tmpdir(), 'rhapsode-cli-'));

describe('readConfig', () => {
    it('reports a missing file as missing, not invalid', () => {
        expect(readConfig(join(scratch(), 'rhapsode.config.json'))).toEqual({ status: 'missing' });
    });

    it('reports JSON that does not parse', () => {
        const path = join(scratch(), 'rhapsode.config.json');
        writeFileSync(path, '{ "server": ');
        expect(readConfig(path).status).toBe('invalid');
    });

    it('refuses a top level that is not an object', () => {
        const path = join(scratch(), 'rhapsode.config.json');
        writeFileSync(path, '[]');
        expect(readConfig(path)).toEqual({ status: 'invalid', error: 'the top level is not an object' });
    });

    it('reads back what starterConfig writes', () => {
        const path = join(scratch(), 'rhapsode.config.json');
        writeFileSync(path, renderConfig(starterConfig(8080, '/abs/venv')));
        expect(readConfig(path)).toEqual({ status: 'ok', config: { server: { port: 8080 }, engines: { tone: { venv: '/abs/venv' } } } });
    });
});

describe('localEngines', () => {
    it('keeps engines with a venv and drops disabled and remote ones', () => {
        const engines = localEngines(
            {
                engines: {
                    tone: { venv: '/abs/tone' },
                    chatterbox: { venv: '/abs/chatterbox', enabled: false },
                    dia: { url: 'http://gpu-02.lan:9310' },
                },
            },
            '/repo',
        );
        expect(engines).toEqual([{ id: 'tone', venv: '/abs/tone' }]);
    });

    it('resolves a relative venv against the repository root', () => {
        expect(localEngines({ engines: { tone: { venv: './python/.venv' } } }, '/repo')).toEqual([{ id: 'tone', venv: '/repo/python/.venv' }]);
    });
});

describe('configPath', () => {
    it('defaults to rhapsode.config.json at the repository root', () => {
        expect(configPath('/repo', {})).toBe('/repo/rhapsode.config.json');
    });

    it('takes a relative RHAPSODE_CONFIG against the repository root, and an absolute one as is', () => {
        expect(configPath('/repo', { RHAPSODE_CONFIG: 'local.json' })).toBe('/repo/local.json');
        expect(configPath('/repo', { RHAPSODE_CONFIG: '/etc/rhapsode.json' })).toBe('/etc/rhapsode.json');
    });
});

describe('displayPath', () => {
    it('is relative inside the repository and absolute outside it', () => {
        expect(displayPath('/repo', '/repo/rhapsode.config.json')).toBe('rhapsode.config.json');
        expect(displayPath('/repo', '/etc/rhapsode.json')).toBe('/etc/rhapsode.json');
    });
});
