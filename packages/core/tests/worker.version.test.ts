import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CORE_VERSION } from '../src/core.version.js';
import { EngineRegistry } from '../src/registry/engine.registry.js';
import { installedWorkerVersion } from '../src/registry/worker.version.js';

let dir: string;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rh-workerversion-'));
});

afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

/** A virtualenv with the given distribution directories in it, laid out the way `venv` lays one out. */
function venvWith(...distributions: string[]): string {
    const venv = join(dir, 'venv');
    const site = process.platform === 'win32' ? join(venv, 'Lib', 'site-packages') : join(venv, 'lib', 'python3.12', 'site-packages');
    mkdirSync(site, { recursive: true });
    for (const distribution of distributions) mkdirSync(join(site, distribution));
    return venv;
}

const license = { code: 'MIT', weights: 'MIT', weightsCommercialUse: true };

describe('reading the worker SDK version out of an engine virtualenv', () => {
    it('reads it from the .dist-info directory name', () => {
        const venv = venvWith('rhapsode_worker-0.1.6.dist-info', 'torch-2.4.1.dist-info');

        expect(installedWorkerVersion(venv)).toBe('0.1.6');
    });

    it('reads the version an upgrade left behind, which is the whole point of the field', () => {
        // The case this exists for: a core at 0.1.6 whose engine was installed by 0.1.2. Nothing
        // is wrong with the venv, and nothing will say so unless something reads it.
        const venv = venvWith('rhapsode_worker-0.1.2.dist-info');

        expect(installedWorkerVersion(venv)).toBe('0.1.2');
    });

    it('says nothing for a remote engine, which has no virtualenv here', () => {
        expect(installedWorkerVersion(undefined)).toBeUndefined();
    });

    it('says nothing rather than throwing when the virtualenv is missing or half-built', () => {
        // The registry reads this while declaring engines at boot, so a throw here would take the
        // server down over a diagnostic.
        expect(installedWorkerVersion(join(dir, 'not-a-venv'))).toBeUndefined();
        expect(installedWorkerVersion(venvWith())).toBeUndefined();
    });

    it('is not fooled by another distribution whose name merely starts the same way', () => {
        expect(installedWorkerVersion(venvWith('rhapsode_worker_extras-9.9.9.dist-info'))).toBeUndefined();
    });

    it('accepts a version with a suffix, because a local build is a legal version', () => {
        expect(installedWorkerVersion(venvWith('rhapsode_worker-0.2.0.dev1+g1234abc.dist-info'))).toBe('0.2.0.dev1+g1234abc');
    });
});

describe('the engine summary', () => {
    it('carries workerVersion for a local engine', () => {
        const registry = new EngineRegistry();
        registry.declare({ id: 'tone', displayName: 'Tone', license, venv: venvWith('rhapsode_worker-0.1.6.dist-info') });

        expect(registry.summaries()[0]?.workerVersion).toBe('0.1.6');
    });

    it('leaves workerVersion off a remote engine rather than inventing one', () => {
        const registry = new EngineRegistry();
        registry.declare({ id: 'dia', displayName: 'Dia', license, url: 'http://gpu-02.lan:9310' });

        expect(registry.summaries()[0]).not.toHaveProperty('workerVersion');
    });

    it('answers for an engine that is down, which is an engine’s ordinary state', () => {
        // § 3: a model leaves the card when nothing is using it, so `down` is what an operator sees
        // most of the time. A version that needed a running worker would be absent exactly when the
        // question is asked.
        const registry = new EngineRegistry();
        registry.declare({ id: 'tone', displayName: 'Tone', license, venv: venvWith('rhapsode_worker-0.1.2.dist-info') });

        const summary = registry.summaries()[0];
        expect(summary?.process).toBe('down');
        expect(summary?.workerVersion).toBe('0.1.2');
    });

    it('forgets the version when the engine is uninstalled', () => {
        const registry = new EngineRegistry();
        registry.declare({ id: 'tone', displayName: 'Tone', license, venv: venvWith('rhapsode_worker-0.1.6.dist-info') });
        registry.remove('tone');

        expect(registry.workerVersion('tone')).toBeUndefined();
    });
});

describe('outdated', () => {
    it('is true for an engine an upgrade left behind', () => {
        const registry = new EngineRegistry();
        registry.declare({ id: 'tone', displayName: 'Tone', license, venv: venvWith('rhapsode_worker-0.0.1.dist-info') });

        expect(registry.summaries()[0]?.outdated).toBe(true);
    });

    it('is false for an engine this core installed', () => {
        const registry = new EngineRegistry();
        registry.declare({ id: 'tone', displayName: 'Tone', license, venv: venvWith(`rhapsode_worker-${CORE_VERSION}.dist-info`) });

        expect(registry.summaries()[0]?.outdated).toBe(false);
    });

    it('is true for a worker newer than the core, because a rollback breaks the pin the same way', () => {
        const registry = new EngineRegistry();
        registry.declare({ id: 'tone', displayName: 'Tone', license, venv: venvWith('rhapsode_worker-999.0.0.dist-info') });

        expect(registry.outdated('tone')).toBe(true);
    });

    it('is absent wherever workerVersion is, rather than guessed', () => {
        const registry = new EngineRegistry();
        registry.declare({ id: 'dia', displayName: 'Dia', license, url: 'http://gpu-02.lan:9310' });

        expect(registry.summaries()[0]).not.toHaveProperty('outdated');
    });

    it('follows a declare that points the engine at a new virtualenv', () => {
        // A reinstall declares the engine again with its new slot, and this is what clears the flag.
        const registry = new EngineRegistry();
        registry.declare({ id: 'tone', displayName: 'Tone', license, venv: venvWith('rhapsode_worker-0.0.1.dist-info') });
        const fresh = join(dir, 'fresh');
        const site = process.platform === 'win32' ? join(fresh, 'Lib', 'site-packages') : join(fresh, 'lib', 'python3.12', 'site-packages');
        mkdirSync(join(site, `rhapsode_worker-${CORE_VERSION}.dist-info`), { recursive: true });
        registry.declare({ id: 'tone', displayName: 'Tone', license, venv: fresh });

        expect(registry.outdated('tone')).toBe(false);
    });
});
