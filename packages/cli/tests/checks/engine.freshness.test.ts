import { describe, expect, it } from 'vitest';

import { freshness } from '../../src/checks/engine.freshness.js';

describe('engine freshness', () => {
    it('is content when every engine is on the core’s version', () => {
        const result = freshness(
            [
                { id: 'tone', workerVersion: '0.1.6' },
                { id: 'kokoro', workerVersion: '0.1.6' },
            ],
            '0.1.6',
        );

        expect(result.ok).toBe(true);
        expect(result.message).toBe('all on 0.1.6');
    });

    it('names an engine an upgrade left behind, and what to do about it', () => {
        // The case this check exists for. Nothing is broken: the worker speaks a contract this core
        // supports, so it goes on working and quietly stops answering anything added since.
        const result = freshness([{ id: 'chatterbox', workerVersion: '0.1.2' }], '0.1.6');

        expect(result.message).toContain('chatterbox 0.1.2');
        expect(result.message).toContain("this core's 0.1.6");
        expect(result.message).toContain('Reinstall');
    });

    it('stays green while saying so, because a stale worker is contract-legal', () => {
        // protocol.md § 9: worth a warning and never a refusal. Red would mean "this checkout is
        // broken", and an operator running an engine at a version of their choosing is not.
        expect(freshness([{ id: 'chatterbox', workerVersion: '0.1.2' }], '0.1.6').ok).toBe(true);
    });

    it('names every engine that is behind, not just the first', () => {
        const result = freshness(
            [
                { id: 'chatterbox', workerVersion: '0.1.2' },
                { id: 'orpheus', workerVersion: '0.1.3' },
                { id: 'tone', workerVersion: '0.1.6' },
            ],
            '0.1.6',
        );

        expect(result.message).toContain('chatterbox 0.1.2');
        expect(result.message).toContain('orpheus 0.1.3');
        expect(result.message).not.toContain('tone');
    });

    it('treats an engine ahead of the core as worth saying too', () => {
        // Negotiation would refuse this one at spawn, but only once something tried to speak it.
        // Saying it here costs nothing and turns a spawn-time refusal into something findable.
        const result = freshness([{ id: 'dia', workerVersion: '0.2.0' }], '0.1.6');

        expect(result.message).toContain('dia 0.2.0');
    });

    it('mentions a venv it could not read without making it this check’s fault', () => {
        // engineVenvs runs first and reports a broken venv in its own language; this one names it
        // so the count adds up and stops there.
        const result = freshness([{ id: 'kokoro' }], '0.1.6');

        expect(result.ok).toBe(true);
        expect(result.message).toContain('kokoro not readable');
        expect(result.message).not.toContain('Reinstall');
    });

    it('says nothing is wrong when there are no engines at all', () => {
        expect(freshness([], '0.1.6')).toEqual({ ok: true, message: 'all on 0.1.6' });
    });
});
