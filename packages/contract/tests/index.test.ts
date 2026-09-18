import { describe, expect, it } from 'vitest';

import {
    Capabilities,
    CatalogEntry,
    CONTRACT_MAJOR,
    CUES,
    DELIVERIES,
    ErrorDetail,
    FeedEvent,
    InstallJob,
    OpenAIErrorBody,
    OpenAISpeechRequest,
    SpeakRequest,
    Variant,
} from '../src/index.js';

describe('the contract', () => {
    it('is major 1', () => {
        expect(CONTRACT_MAJOR).toBe(1);
    });

    it('carries the eight cues and the two deliveries', () => {
        expect(CUES).toEqual(['laugh', 'chuckle', 'sigh', 'gasp', 'cough', 'clear throat', 'sniff', 'groan']);
        expect(DELIVERIES).toEqual(['hushed', 'frantic']);
    });
});

describe('the generated schemas', () => {
    it('parse a capability document whose model is unloaded', () => {
        // § 4 as amended: `current` is absent when nothing is resident, and nothing may depend on it.
        const parsed = Capabilities.parse({
            contract: 1,
            engine: { id: 'tone', displayName: 'Tone', adapterVersion: '0.0.0' },
            license: { code: 'MIT', weights: 'MIT', weightsCommercialUse: true },
            device: { type: 'cpu', name: 'test' },
            variants: { default: { cues: [], deliveries: [], dials: {} } },
            formats: ['wav', 'pcm'],
        });

        expect(parsed.current).toBeUndefined();
        expect(parsed.contract).toBe(1);
    });

    it('lets an older reader through a newer worker’s extra fields', () => {
        // § 9: additive only, and a reader ignores what it does not know. A strict schema would
        // turn every additive change into a hard failure at the version skew § 9 exists to survive.
        const parsed = Variant.parse({ cues: [], deliveries: [], dials: {}, addedInContract2: true });

        expect(parsed).toMatchObject({ addedInContract2: true });
    });

    it('refuses a speak request with a misspelled field', () => {
        // The other direction, and deliberately not symmetrical. `streaming` is not `stream`, and a
        // silently dropped intention is the failure § 6 spends a section arguing against.
        expect(() => SpeakRequest.parse({ text: 'hello', streaming: true })).toThrow();
    });

    it('refuses an empty text', () => {
        expect(() => SpeakRequest.parse({ text: '' })).toThrow();
    });
});

describe('the management shapes', () => {
    it('parse a catalog entry for an engine this box does not have', () => {
        const parsed = CatalogEntry.parse({
            id: 'chatterbox',
            displayName: 'Chatterbox',
            license: { code: 'MIT', weights: 'MIT', weightsCommercialUse: true },
            package: 'rhapsode-engine-chatterbox',
            defaultVariant: 'turbo',
            installed: 'no',
            managed: false,
        });

        expect(parsed.installed).toBe('no');
    });

    it('parse a failed job, whose error is an ordinary envelope body', () => {
        const parsed = InstallJob.parse({
            id: 'j1',
            engine: 'chatterbox',
            kind: 'install',
            state: 'failed',
            step: 'packages',
            createdAt: '2026-09-18T14:02:11.000Z',
            error: { code: 'internal', message: 'pip exited 1', retryable: false },
        });

        expect(parsed.error?.code).toBe('internal');
    });

    it('parse a feed event as ServerKit frames it', () => {
        const parsed = FeedEvent.parse({
            id: 7,
            ts: '2026-09-18T14:02:12.000Z',
            source: 'install',
            level: 'info',
            kind: 'progress',
            correlationId: 'j1',
            progress: { phase: 'packages', index: 2, total: 4, status: 'running' },
        });

        expect(parsed.progress?.phase).toBe('packages');
    });

    it('carry the two management error codes at the end of the taxonomy', () => {
        expect(ErrorDetail.shape.code.options.slice(-2)).toEqual(['forbidden', 'conflict']);
    });
});

describe('the OpenAI shim shapes', () => {
    it('parse the request an OpenAI SDK sends', () => {
        const parsed = OpenAISpeechRequest.parse({ model: 'chatterbox:turbo', input: 'hello', voice: 'alloy', response_format: 'opus', speed: 1 });

        expect(parsed.model).toBe('chatterbox:turbo');
    });

    it('refuse a field OpenAI does not have, as OpenAI does', () => {
        // § 11: OpenAI's own API answers an unrecognised field with a 400, so a strict schema holds
        // a client to nothing it was not already held to.
        expect(() => OpenAISpeechRequest.parse({ model: 'tone', input: 'hello', seed: 7 })).toThrow();
    });

    it('keep a taxonomy code from a newer contract in the error envelope', () => {
        // § 9: losing the envelope over an unfamiliar code is the worst possible trade.
        const parsed = OpenAIErrorBody.parse({ error: { message: 'x', type: 'server_error', code: 'added_in_contract_2', retryable: true } });

        expect(parsed.error.code).toBe('added_in_contract_2');
    });
});
