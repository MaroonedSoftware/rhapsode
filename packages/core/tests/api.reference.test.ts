import { afterEach, describe, expect, it } from 'vitest';

import { CORE_VERSION } from '../src/core.version.js';
import { RhapsodeJsonLogger } from '../src/logging/rhapsode.logger.js';
import { buildServer } from '../src/server.js';

const silent = () => new RhapsodeJsonLogger('error', () => {});

let running: Awaited<ReturnType<typeof buildServer>> | undefined;

async function document() {
    running = await buildServer({}, silent());
    await running.app.ready();
    const response = await running.app.inject({ method: 'GET', url: '/openapi.json' });
    expect(response.statusCode).toBe(200);
    return { app: running.app, body: response.json() as { info: { version: string }; paths: Record<string, Record<string, unknown>> } };
}

afterEach(async () => {
    await running?.app.close();
    running = undefined;
});

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

describe('GET /openapi.json', () => {
    it('is open to a caller the management guard would refuse', async () => {
        // Remote and tokenless: the caller the § 10 routes turn away. The document says nothing a
        // caller could not learn by trying, so it is answered like /health.
        running = await buildServer({}, silent());
        await running.app.ready();
        const response = await running.app.inject({ method: 'GET', url: '/openapi.json', remoteAddress: '203.0.113.9' });

        expect(response.statusCode).toBe(200);
    });

    it('carries the running core version, not a number fixed at codegen', async () => {
        const { body } = await document();
        expect(body.info.version).toBe(CORE_VERSION);
    });

    it('describes only routes this core answers', async () => {
        // A path in the document that the core does not route is a promise nobody keeps. The first
        // combined document made one: a /speak with no engine, which is the worker's.
        const { app, body } = await document();

        const described = Object.entries(body.paths).flatMap(([path, operations]) =>
            METHODS.filter(method => method in operations).map(method => ({ method: method.toUpperCase(), url: path.replace(/\{(\w+)\}/g, ':$1') })),
        );
        expect(described.length).toBeGreaterThan(10);
        // hasRoute can tell: the core has no /load, which is the worker's.
        expect(app.hasRoute({ method: 'POST', url: '/load' })).toBe(false);
        expect(described.filter(route => !app.hasRoute(route as Parameters<typeof app.hasRoute>[0]))).toEqual([]);
    });

    it('names no worker route', async () => {
        // A client author should never learn that workers exist. protocol.md § 1.
        const { body } = await document();
        for (const path of ['/capabilities', '/voices', '/load', '/unload', '/terminate', '/fetch']) {
            expect(body.paths).not.toHaveProperty([path]);
        }
    });
});
