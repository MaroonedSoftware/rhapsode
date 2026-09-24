import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';
import { afterEach, describe, expect, it } from 'vitest';

import { CORE_VERSION } from '../src/core.version.js';
import { buildServer } from '../src/server.js';
import { RhapsodeJsonLogger } from '../src/logging/rhapsode.logger.js';
import type { RhapsodeConfig } from '../src/config.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const canBindUnixSockets = await (async () => {
    const directory = mkdtempSync(join(tmpdir(), 'rh-probe-'));
    try {
        const server = createServer();
        await new Promise<void>((fulfil, fail) => {
            server.once('error', fail);
            server.listen(join(directory, 'p.sock'), fulfil);
        });
        await new Promise<void>(fulfil => server.close(() => fulfil()));
        return true;
    } catch {
        return false;
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
})();

const describeWithSockets = canBindUnixSockets ? describe : describe.skip;

const silent = () => new RhapsodeJsonLogger('error', () => {});

let running: Awaited<ReturnType<typeof buildServer>> | undefined;
let socketDir: string | undefined;

async function start(settings: RhapsodeConfig = {}) {
    const builder = await buildServer(settings, silent());
    running = builder;
    await builder.app.ready();
    return builder;
}

let client: Client | undefined;

afterEach(async () => {
    await client?.close();
    client = undefined;
    await running?.app.close();
    running = undefined;
    if (socketDir !== undefined) rmSync(socketDir, { recursive: true, force: true });
    socketDir = undefined;
});

/** The tone engine, a real worker that speaks sine waves. */
async function startTone() {
    socketDir = mkdtempSync(join(tmpdir(), 'rh-'));
    return start({ workers: { socketDir, startupTimeoutSeconds: 30 }, engines: { tone: { venv: join(REPO, 'python/.venv') } } });
}

/**
 * The SDK's own client, over its own Streamable HTTP transport, with `fetch` routed into the core.
 * It is the one reader that checks structured content against `outputSchema` and fails the call
 * when they disagree, which is the promise `outputSchema` makes and nothing else here would test.
 */
async function connect() {
    const viaInject: FetchLike = async (url, init) => {
        const target = new URL(url);
        const response = await running!.app.inject({
            method: (init?.method ?? 'GET') as 'GET' | 'POST' | 'DELETE',
            url: target.pathname + target.search,
            headers: Object.fromEntries(new Headers(init?.headers).entries()),
            ...(typeof init?.body === 'string' ? { payload: init.body } : {}),
        });
        const headers = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
            if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : String(value));
        }
        const empty = response.statusCode === 202 || response.statusCode === 204 || response.rawPayload.length === 0;
        return new Response(empty ? null : new Uint8Array(response.rawPayload), { status: response.statusCode, headers });
    };
    client = new Client({ name: 'test', version: '0' });
    await client.connect(new StreamableHTTPClientTransport(new URL('http://rhapsode.test/mcp'), { fetch: viaInject }));
    return client;
}

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
    return response.json().result as { isError?: boolean; content: { type: string; text?: string; data?: string; mimeType?: string }[] };
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

        expect(tools.map(tool => tool.name).sort()).toEqual(['engine_capabilities', 'list_engines', 'list_voices', 'speak', 'speak_dialogue']);
        const readOnly = tools.filter(tool => tool.annotations?.readOnlyHint === true).map(tool => tool.name);
        expect(readOnly.sort()).toEqual(['engine_capabilities', 'list_engines', 'list_voices']);
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

describe('the speak tools, before anything is spoken', () => {
    it('offers no stream, because a tool result is one message', async () => {
        await start({ engines: { tone: { venv: '/nowhere' } } });
        const result = await call('speak', { engine: 'tone', text: 'x', stream: true });

        expect(result.isError).toBe(true);
        expect(result.content[0]!.text).toMatch(/^bad_request: /);
    });

    it('refuses a turn with no speaker, with the path to it', async () => {
        await start({ engines: { tone: { venv: '/nowhere' } } });
        const result = await call('speak_dialogue', { engine: 'tone', turns: [{ text: 'Who said this?' }] });

        expect(result.isError).toBe(true);
        expect(result.content[0]!.text).toContain('`turns.0.speaker`');
    });
});

describeWithSockets('speaking through MCP', () => {
    const direct = (body: Record<string, unknown>) =>
        running!.app.inject({ method: 'POST', url: '/speak', headers: { 'content-type': 'application/json' }, payload: JSON.stringify(body) });

    it('answers with the audio /speak gives, as audio content, in wav unless asked', async () => {
        await startTone();
        const result = await call('speak', { engine: 'tone', text: 'a line to speak', voice: 'sine' });

        expect(result.isError).toBeUndefined();
        const [audio, summary] = result.content;
        expect(audio).toMatchObject({ type: 'audio', mimeType: 'audio/wav' });
        const spoken = await direct({ engine: 'tone', text: 'a line to speak', voice: 'sine', format: 'wav', stream: false });
        expect(Buffer.from(audio!.data!, 'base64').equals(spoken.rawPayload)).toBe(true);
        expect(summary).toMatchObject({ type: 'text' });
        expect(summary!.text).toContain('engine tone');
    });

    it('names pcm’s rate in the mime type, which is the only place it is written', async () => {
        await startTone();
        const result = await call('speak', { engine: 'tone', text: 'a line to speak', format: 'pcm' });

        expect(result.content[0]!.mimeType).toMatch(/^audio\/L16; rate=\d+; channels=1$/);
    });

    it('reports a voice the engine lacks as a tool that failed', async () => {
        await startTone();
        const result = await call('speak', { engine: 'tone', text: 'a line to speak', voice: 'nobody' });

        expect(result.isError).toBe(true);
        expect(result.content[0]!.text).toMatch(/^unknown_voice: /);
    });

    it('holds an agent to the ceiling /speak holds everybody to', async () => {
        await startTone();
        const text = 'x'.repeat(5000);
        const spoken = await direct({ engine: 'tone', text, stream: false });
        const result = await call('speak', { engine: 'tone', text });

        expect(spoken.statusCode).toBeGreaterThanOrEqual(400);
        expect(result.isError).toBe(true);
        expect(result.content[0]!.text).toContain(spoken.json().error.message);
    });

    it('speaks a dialogue in one take', async () => {
        await startTone();
        const result = await call('speak_dialogue', {
            engine: 'tone',
            turns: [
                { speaker: 'a', text: 'Did you hear that?' },
                { speaker: 'b', text: 'It is only the cat.' },
            ],
        });

        expect(result.isError).toBeUndefined();
        expect(result.content[0]).toMatchObject({ type: 'audio', mimeType: 'audio/wav' });
        expect(result.content[1]!.text).toContain('2 turns');
    });
});

describe('an MCP client', () => {
    it('connects, lists the tools and reads engines checked against their outputSchema', async () => {
        await start({ engines: { tone: { venv: '/nowhere' } } });
        const mcp = await connect();

        expect(mcp.getServerVersion()).toMatchObject({ name: 'rhapsode', version: CORE_VERSION });
        const { tools } = await mcp.listTools();
        expect(tools.find(tool => tool.name === 'list_engines')?.outputSchema).toMatchObject({ required: ['items'] });

        // callTool validates structuredContent against outputSchema and throws when it does not fit.
        const result = await mcp.callTool({ name: 'list_engines', arguments: {} });
        expect(result.structuredContent).toMatchObject({ items: [{ id: 'tone' }] });
    });

    it('sees a refusal as a failed tool, not a failed call', async () => {
        await start();
        const mcp = await connect();

        const result = await mcp.callTool({ name: 'list_voices', arguments: { engine: 'nope' } });
        expect(result.isError).toBe(true);
        expect(result.structuredContent).toBeUndefined();
    });
});

describeWithSockets('an MCP client against a real worker', () => {
    it('reads capabilities and voices that fit their outputSchema', async () => {
        await startTone();
        const mcp = await connect();

        const capabilities = await mcp.callTool({ name: 'engine_capabilities', arguments: { engine: 'tone' } });
        expect(capabilities.isError).toBeUndefined();
        expect(capabilities.structuredContent).toMatchObject({ engine: { id: 'tone' } });

        const voices = await mcp.callTool({ name: 'list_voices', arguments: { engine: 'tone' } });
        expect((voices.structuredContent as { items: { id: string }[] }).items.map(voice => voice.id)).toContain('sine');
    });

    it('speaks, and the audio arrives as audio content', async () => {
        await startTone();
        const mcp = await connect();

        const result = await mcp.callTool({ name: 'speak', arguments: { engine: 'tone', text: 'a line to speak' } });
        expect((result.content as { type: string; mimeType?: string }[])[0]).toMatchObject({ type: 'audio', mimeType: 'audio/wav' });
    });
});
