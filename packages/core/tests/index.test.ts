import { describe, expect, it } from 'vitest';

import { ErrorDetail } from '@rhapsode/contract';

import { CATALOG, DEFAULTS, EngineRegistry, RhapsodeError, TAXONOMY } from '../src/index.js';

describe('the core barrel', () => {
    it('exposes what a composition root needs and nothing model-shaped', () => {
        expect(typeof EngineRegistry).toBe('function');
        expect(DEFAULTS.maxResidentModels).toBe(1);
        expect(Object.keys(CATALOG)).toContain('tone');
    });
});

describe('the error taxonomy', () => {
    it('derives retryable from the code, so the two cannot disagree', () => {
        expect(new RhapsodeError('oom', 'no room').retryable).toBe(true);
        expect(new RhapsodeError('bad_request', 'wrong').retryable).toBe(false);
    });

    it('matches the statuses the protocol names', () => {
        expect(TAXONOMY.model_unavailable).toEqual({ status: 503, retryable: true });
        expect(TAXONOMY.overloaded).toEqual({ status: 429, retryable: true });
        expect(TAXONOMY.unknown_engine).toEqual({ status: 404, retryable: false });
        expect(TAXONOMY.forbidden).toEqual({ status: 403, retryable: false });
        expect(TAXONOMY.conflict).toEqual({ status: 409, retryable: false });
    });

    it('has exactly the codes the contract declares', () => {
        // Two lists of the same set drift the day somebody grows one. § 9 grows it at the end.
        expect(Object.keys(TAXONOMY)).toEqual(ErrorDetail.shape.code.options);
    });

    it('names what is installed when an engine is not', () => {
        const failure = RhapsodeError.unknownEngine('chatterbox', ['tone', 'piper']);
        expect(failure.status).toBe(404);
        expect(failure.message).toBe('no engine "chatterbox"; this server has piper, tone');
    });
});
