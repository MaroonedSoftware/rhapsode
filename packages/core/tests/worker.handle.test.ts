import { EventEmitter } from 'node:events';

import { describe, expect, it } from 'vitest';

import { RhapsodeJsonLogger } from '../src/logging/rhapsode.logger.js';
import type { EngineEntry } from '../src/registry/engine.registry.js';
import type { WorkerClient } from '../src/workers/worker.client.js';
import { LocalWorkerHandle, RemoteWorkerHandle, type SupervisorOptions } from '../src/workers/worker.handle.js';

const silent = () => new RhapsodeJsonLogger('error', () => {});

class FakeClient {
    terminated = 0;
    closed = 0;
    refuseTerminate = false;
    /** What a worker does on `/terminate`: drain, then exit. */
    onTerminate: (() => void) | undefined;

    async terminate(): Promise<void> {
        this.terminated += 1;
        if (this.refuseTerminate) throw new Error('the worker did not answer');
        this.onTerminate?.();
    }

    async close(): Promise<void> {
        this.closed += 1;
    }
}

const asClient = (client: FakeClient) => client as unknown as WorkerClient;

class FakeChild extends EventEmitter {
    exitCode: number | null = null;
    readonly signals: NodeJS.Signals[] = [];
    /** A worker wedged past answering, to prove the SIGKILL backstop still lands. */
    ignoreTerm = false;

    kill(signal: NodeJS.Signals): boolean {
        this.signals.push(signal);
        if (signal === 'SIGTERM' && this.ignoreTerm) return true;
        this.exit(signal === 'SIGKILL' ? 137 : 0);
        return true;
    }

    exit(code: number): void {
        this.exitCode = code;
        this.emit('exit', code, null);
    }
}

const options: SupervisorOptions = {
    startupTimeoutSeconds: 5,
    drainGraceMs: 20,
    maxRestarts: 5,
    restartDecaySeconds: 300,
};

const entry: EngineEntry = { id: 'tone', displayName: 'Tone', license: { id: 'MIT', url: 'https://example.invalid' } };

/**
 * A handle already up, without spawning anything.
 *
 * `child` and `client` are what `start()` sets, and reaching past the privates is the price of
 * covering the stop sequence in a suite that runs where sockets do not. The socket suite covers the
 * same ground against a real worker when it can run.
 */
const started = (client: FakeClient, child: FakeChild) => {
    const handle = new LocalWorkerHandle('tone', entry, options, silent(), () => {});
    Object.assign(handle as unknown as { child: FakeChild; client: WorkerClient }, { child, client: asClient(client) });
    return handle;
};

describe('a remote worker handle', () => {
    it('terminates on an eviction and keeps its connection', async () => {
        // Closing the pool was what an eviction used to do, and `ensureUp` then handed out a client
        // that could not answer. Idle freeing makes this path routine.
        const client = new FakeClient();
        const handle = new RemoteWorkerHandle('remote', 'http://worker.invalid', asClient(client));

        await handle.stop('evict');

        expect(client.terminated).toBe(1);
        expect(client.closed).toBe(0);
        expect(await handle.ensureUp()).toBe(handle.client);
    });

    it('closes its connection on shutdown, because the process is not the core to exit', async () => {
        const client = new FakeClient();
        const handle = new RemoteWorkerHandle('remote', 'http://worker.invalid', asClient(client));

        await handle.stop('shutdown');

        expect(client.terminated).toBe(0);
        expect(client.closed).toBe(1);
    });
});

describe('a local worker handle', () => {
    it('asks for the verb before it signals, and never signals when the worker obeys', async () => {
        const child = new FakeChild();
        const client = new FakeClient();
        client.onTerminate = () => child.exit(0);

        await started(client, child).stop('evict');

        expect(client.terminated).toBe(1);
        expect(child.signals).toEqual([]);
        expect(child.exitCode).toBe(0);
    });

    it('signals when the verb does not land', async () => {
        const child = new FakeChild();
        const client = new FakeClient();
        client.refuseTerminate = true;

        await started(client, child).stop('evict');

        expect(client.terminated).toBe(1);
        expect(child.signals).toEqual(['SIGTERM']);
    });

    it('signals without asking on shutdown, which § 2 calls the same sequence', async () => {
        const child = new FakeChild();
        const client = new FakeClient();

        await started(client, child).stop('shutdown');

        expect(client.terminated).toBe(0);
        expect(child.signals).toEqual(['SIGTERM']);
    });

    it('kills a worker that took the verb and never went', async () => {
        const child = new FakeChild();
        child.ignoreTerm = true;
        const client = new FakeClient();

        await started(client, child).stop('evict');

        expect(client.terminated).toBe(1);
        expect(child.signals).toEqual(['SIGKILL']);
        expect(child.exitCode).toBe(137);
    });

    it('closes the connection once the process has gone, not before', async () => {
        const child = new FakeChild();
        const client = new FakeClient();
        client.onTerminate = () => {
            // The verb has to reach the worker while the connection is still open, which is the
            // ordering the old stop had backwards.
            expect(client.closed).toBe(0);
            child.exit(0);
        };

        await started(client, child).stop('evict');

        expect(client.closed).toBe(1);
    });
});
