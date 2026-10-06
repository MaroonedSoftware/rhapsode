import { describe, expect, it } from 'vitest';

import type { ManagementClient } from '../../src/lib/management.client.js';
import { offerWarm, unwarmed } from '../../src/lib/warm.js';

const variant = (compiles?: boolean) => ({ cues: [], deliveries: [], dials: {}, ...(compiles === undefined ? {} : { compiles }) });

describe('what is left to warm', () => {
    // Orpheus on Linux: full compiles, the GGUF builds do not. protocol.md § 8.
    const orpheus = { variants: { full: variant(true), q8: variant(), q4: variant(false) } };

    it('is every variant that compiles, for an engine nothing has warmed', () => {
        expect(unwarmed({}, orpheus)).toEqual(['full']);
    });

    it('leaves out what the catalog says was warmed', () => {
        expect(unwarmed({ warmed: ['full'] }, orpheus)).toEqual([]);
    });

    it('is nothing for an engine with no variant that compiles', () => {
        expect(unwarmed({}, { variants: { plain: variant() } })).toEqual([]);
    });

    it('ignores a recorded variant the worker no longer declares', () => {
        expect(unwarmed({ warmed: ['gone'] }, orpheus)).toEqual(['full']);
    });
});

describe('offering a warm after a reinstall', () => {
    const job = (engine: string, variant: string, state: 'running' | 'succeeded') =>
        ({ id: `${engine}-${variant}`, engine, kind: 'warm', variant, state, createdAt: '2026-10-06T12:00:00.000Z' }) as const;

    /** A server with Orpheus installed, nothing warmed, and full compiling; and one engine that compiles nothing. */
    function fakes(answer: boolean, warmed?: string[]) {
        const asked: string[] = [];
        const warmedNow: string[] = [];
        const capabilitiesAsked: string[] = [];
        const entry = (id: string, managed = true) => ({
            id,
            displayName: id,
            license: { code: 'MIT', weights: 'MIT', weightsCommercialUse: true },
            package: `rhapsode-engine-${id}`,
            installed: 'yes' as const,
            managed,
            ...(id === 'orpheus' && warmed !== undefined ? { warmed } : {}),
        });
        const api = {
            catalog: async () => [entry('orpheus'), entry('kokoro'), entry('mine', false)],
            capabilities: async (id: string) => {
                capabilitiesAsked.push(id);
                return { variants: id === 'orpheus' ? { full: variant(true), q8: variant() } : { only: variant() } };
            },
            warm: async (id: string, chosen: string) => {
                warmedNow.push(`${id} ${chosen}`);
                return job(id, chosen, 'running');
            },
            follow: async (id: string) => job(id.split('-')[0]!, id.split('-')[1]!, 'succeeded'),
        };
        const ui = {
            info: () => {},
            warn: () => {},
            error: () => {},
            success: () => {},
            confirm: async (message: string) => {
                asked.push(message);
                return answer;
            },
            progress: () => ({ step: () => {}, line: () => {}, stop: () => {} }),
        };
        return { api: api as unknown as ManagementClient, ui, asked, warmedNow, capabilitiesAsked };
    }

    it('asks once about what the reinstalled engines left unwarmed, and warms it on a yes', async () => {
        const { api, ui, asked, warmedNow } = fakes(true);

        expect(await offerWarm(api, ui, ['orpheus', 'kokoro'])).toBe(0);

        expect(asked).toHaveLength(1);
        expect(asked[0]).toMatch(/^orpheus full compiles on its first load/);
        expect(warmedNow).toEqual(['orpheus full']);
    });

    it('warms nothing on a no', async () => {
        const { api, ui, warmedNow } = fakes(false);
        expect(await offerWarm(api, ui, ['orpheus'])).toBe(0);
        expect(warmedNow).toEqual([]);
    });

    it('asks nothing when what compiles was warmed, or nothing was reinstalled', async () => {
        const warm = fakes(true, ['full']);
        expect(await offerWarm(warm.api, warm.ui, ['orpheus'])).toBe(0);
        expect(warm.asked).toEqual([]);

        const none = fakes(true);
        expect(await offerWarm(none.api, none.ui, [])).toBe(0);
        expect(none.capabilitiesAsked).toEqual([]);
    });

    // Its warms are never recorded, so it would be offered after every reinstall. § 10.
    it('leaves out an engine the operator configured, and never starts its worker to ask', async () => {
        const { api, ui, asked, capabilitiesAsked } = fakes(true);
        expect(await offerWarm(api, ui, ['mine'])).toBe(0);
        expect(asked).toEqual([]);
        expect(capabilitiesAsked).toEqual([]);
    });
});
