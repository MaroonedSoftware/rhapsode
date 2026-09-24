import { afterEach, describe, expect, it } from 'vitest';

import { CORE_VERSION } from '../src/core.version.js';
import { buildServer } from '../src/server.js';
import { RhapsodeJsonLogger } from '../src/logging/rhapsode.logger.js';
import type { RhapsodeConfig } from '../src/config.js';

const silent = () => new RhapsodeJsonLogger('error', () => {});

let running: Awaited<ReturnType<typeof buildServer>> | undefined;

async function start(settings: RhapsodeConfig = {}) {
    const builder = await buildServer(settings, silent());
    running = builder;
    await builder.app.ready();
    return builder;
}

afterEach(async () => {
    await running?.app.close();
    running = undefined;
});

let id = 0;

async function rpc(method: string, params?: Record<string, unknown>, headers: Record<string, string> = {}) {
    const response = await running!.app.inject({
        method: 'POST',
        url: '/mcp',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
        payload: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, ...(params === undefined ? {} : { params }) }),
    });
    return response;
}

async function call(name: string, args: Record<string, unknown> = {}) {
    const response = await rpc('tools/call', { name, arguments: args });
    expect(response.statusCode).toBe(200);
    return response.json().result as { isError?: boolean; content: { type: string; text?: string }[] };
}

describe('POST /mcp', () => {
    it('introduces itself as this core, at this version', async () => {
        await start();
        const response = await rpc('initialize', {
            protocolVersion: '2025-11-25',
            capabilities: {},
            clientInfo: { name: 'test', version: '0' },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json().result).toMatchObject({ serverInfo: { name: 'rhapsode', version: CORE_VERSION }, capabilities: { tools: {} } });
    });

    it('answers a notification with a bare 202', async () => {
        await start();
        const response = await running!.app.inject({
            method: 'POST',
            url: '/mcp',
            headers: { 'content-type': 'application/json' },
            payload: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
        });

        expect(response.statusCode).toBe(202);
        expect(response.body).toBe('');
    });

    it('lists the public tools and nothing from § 10', async () => {
        await start();
        const tools = (await rpc('tools/list')).json().result.tools as { name: string; annotations?: { readOnlyHint?: boolean } }[];

        expect(tools.map(tool => tool.name).sort()).toEqual(['engine_capabilities', 'list_engines', 'list_voices']);
        expect(tools.every(tool => tool.annotations?.readOnlyHint === true)).toBe(true);
    });

    it('answers list_engines with what GET /engines says', async () => {
        const builder = await start({ engines: { tone: { venv: '/nowhere' } } });
        const direct = (await builder.app.inject({ method: 'GET', url: '/engines' })).json();

        const result = await call('list_engines');
        expect(result.isError).toBeUndefined();
        expect(JSON.parse(result.content[0]!.text!)).toEqual(direct);
    });

    it('reports an unknown engine as a tool that failed, naming the ones there are', async () => {
        // A JSON-RPC error is something a client reports and stops at. A failed tool is text the
        // agent reads, and this one tells it what to ask for instead.
        await start({ engines: { tone: { venv: '/nowhere' } } });
        const result = await call('list_voices', { engine: 'nope' });

        expect(result.isError).toBe(true);
        expect(result.content[0]!.text).toMatch(/^unknown_engine: no engine "nope"; this server has tone/);
    });

    it('refuses arguments its own schema does not describe', async () => {
        await start();
        const result = await call('engine_capabilities', { engine: 'tone', extra: 1 });

        expect(result.isError).toBe(true);
        expect(result.content[0]!.text).toMatch(/^bad_request: /);
    });

    it('answers a body that is not JSON-RPC with 400', async () => {
        await start();
        const response = await running!.app.inject({
            method: 'POST',
            url: '/mcp',
            headers: { 'content-type': 'application/json' },
            payload: JSON.stringify({ hello: 'world' }),
        });

        expect(response.statusCode).toBe(400);
        expect(response.json()).toMatchObject({ jsonrpc: '2.0', error: { code: -32600 } });
    });
});

describe('who may call /mcp', () => {
    it('refuses a page from somewhere else', async () => {
        // The transport's DNS-rebinding rule, and § 10's measurement: a page the operator visits can
        // POST here from their browser as easily as the operator can.
        await start();
        const response = await rpc('tools/list', undefined, { origin: 'https://evil.example' });

        expect(response.statusCode).toBe(403);
        expect(response.json()).toMatchObject({ error: { code: 'forbidden' } });
    });

    it('answers a page from this machine, and one the operator named', async () => {
        await start({ management: { origins: ['http://tower:8081'] } });

        expect((await rpc('tools/list', undefined, { origin: 'http://localhost:8081' })).statusCode).toBe(200);
        expect((await rpc('tools/list', undefined, { origin: 'http://tower:8081' })).statusCode).toBe(200);
    });

    it('answers a caller on another machine with no token, as /speak does', async () => {
        await start({ management: { token: 'secret' } });
        const response = await running!.app.inject({
            method: 'POST',
            url: '/mcp',
            remoteAddress: '203.0.113.9',
            headers: { 'content-type': 'application/json' },
            payload: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
        });

        expect(response.statusCode).toBe(200);
    });

    it('offers no stream and no session to end', async () => {
        await start();
        for (const method of ['GET', 'DELETE'] as const) {
            const response = await running!.app.inject({ method, url: '/mcp' });
            expect(response.statusCode).toBe(405);
            expect(response.headers.allow).toBe('POST');
        }
    });
});
