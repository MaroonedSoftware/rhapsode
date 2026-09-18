import { describe, expect, it } from 'vitest';
import { SdkError } from '@rhapsode/sdk';

import { ApiRefusal, apiErrorCode, apiErrorMessage, isUnreachable, unwrap } from '../../src/api/sdk.error';

describe('unwrap', () => {
    it('hands back a success value', () => {
        expect(unwrap({ status: 202, data: { id: 'j1' } })).toEqual({ id: 'j1' });
    });

    it('throws a declared refusal with the core’s code and sentence', () => {
        const refused = () =>
            unwrap({ status: 409, data: { error: { code: 'conflict', message: '"tone" is already installed', retryable: false } } });
        expect(refused).toThrow(ApiRefusal);
        expect(refused).toThrow('"tone" is already installed');
    });
});

describe('reading a failure', () => {
    const envelope = { error: { code: 'forbidden', message: 'management routes answer loopback callers', retryable: false } };

    it('reads the envelope from either kind of failure', () => {
        const thrown = new SdkError(403, 'Forbidden', envelope, new Headers());
        expect(apiErrorCode(thrown)).toBe('forbidden');
        expect(apiErrorMessage(thrown, 'fallback')).toBe('management routes answer loopback callers');
        expect(apiErrorCode(new ApiRefusal(409, 'conflict', 'no'))).toBe('conflict');
    });

    it('calls a failed fetch, or a proxy with no core behind it, unreachable', () => {
        expect(isUnreachable(new TypeError('fetch failed'))).toBe(true);
        expect(isUnreachable(new SdkError(502, 'Bad Gateway', '', new Headers()))).toBe(true);
        expect(
            isUnreachable(
                new SdkError(503, 'Service Unavailable', { error: { code: 'model_unavailable', message: 'x', retryable: true } }, new Headers()),
            ),
        ).toBe(false);
    });
});
