import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Capabilities, CatalogEntry } from '@maroonedsoftware/rhapsode-sdk';

import { TryPanel } from '../../../src/components/try/try.panel';
import { render, screen, setupUser, waitFor, within } from '../../utils/render';

const api = vi.hoisted(() => ({
    engineCapabilities: vi.fn(),
    engineVoices: vi.fn(),
    speak: vi.fn(),
    catalog: vi.fn<() => Promise<CatalogEntry[]>>(),
    engines: vi.fn(),
}));

vi.mock('../../../src/api/client', () => ({ BASE_URL: '/api', sdk: { public: api } }));
// The "as code" snippet links to the API reference, and these tests render with no router around it.
vi.mock('@tanstack/react-router', () => ({
    Link: ({ to, children, ...props }: { to: string; children?: ReactNode }) => (
        <a href={to} {...props}>
            {children}
        </a>
    ),
}));

/** Chatterbox's document, trimmed: turbo performs cues and has no dials; original is the other way round. */
const capabilities: Capabilities = {
    contract: 1,
    engine: { id: 'chatterbox', displayName: 'Chatterbox', adapterVersion: '0.0.0' },
    license: { code: 'MIT', weights: 'MIT', weightsCommercialUse: true },
    device: { type: 'mps', name: 'arm' },
    variants: {
        turbo: { cues: ['laugh', 'sigh'], deliveries: [], dials: {} },
        original: { cues: [], deliveries: ['hushed', 'frantic'], dials: { exaggeration: { min: 0, max: 2, default: 0.5 } } },
    },
    formats: ['wav'],
};

describe('TryPanel', () => {
    beforeEach(() => {
        for (const mock of Object.values(api)) mock.mockReset();
        api.engineCapabilities.mockResolvedValue({ status: 200, data: capabilities });
        api.engineVoices.mockResolvedValue({ status: 200, data: [{ id: 'narrator', label: 'Narrator', spec: 'narrator@turbo:ab' }] });
        api.speak.mockResolvedValue({ status: 200, contentType: 'audio/wav', data: new Blob([new Uint8Array(2048)], { type: 'audio/wav' }) });
        globalThis.URL.createObjectURL = vi.fn(() => 'blob:spoken');
        globalThis.URL.revokeObjectURL = vi.fn();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('starts on the engine’s default variant and offers only the cues it performs', async () => {
        render(<TryPanel engine="chatterbox" defaultVariant="turbo" />);

        expect(await screen.findByRole('button', { name: 'laugh' })).toBeInTheDocument();
        expect(screen.queryByText('Delivery')).not.toBeInTheDocument();
        expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    });

    it('offers cloning only on a variant that says it clones, with nothing loaded', async () => {
        // Orpheus's shape if its base model cloned and its finetune did not: `current` is absent, so
        // the variants are all the page has to go on. § 4.
        api.engineCapabilities.mockResolvedValue({
            status: 200,
            data: {
                ...capabilities,
                variants: {
                    turbo: { ...capabilities.variants.turbo!, cloning: { supported: false } },
                    original: { ...capabilities.variants.original!, cloning: { supported: true } },
                },
            },
        });
        const user = setupUser();
        render(<TryPanel engine="chatterbox" defaultVariant="turbo" />);

        await screen.findByRole('button', { name: 'laugh' });
        expect(screen.queryByText('Clone a voice')).not.toBeInTheDocument();

        await user.click(screen.getByRole('combobox', { name: 'Variant' }));
        await user.click(await screen.findByRole('option', { name: 'original' }));

        expect(await screen.findByText('Clone a voice')).toBeInTheDocument();
    });

    it('trades cues for deliveries and dials when the variant changes', async () => {
        const user = setupUser();
        render(<TryPanel engine="chatterbox" defaultVariant="turbo" />);

        await user.click(await screen.findByRole('combobox', { name: 'Variant' }));
        await user.click(await screen.findByRole('option', { name: 'original' }));

        expect(await screen.findByText('Delivery')).toBeInTheDocument();
        expect(screen.getByRole('slider', { name: 'exaggeration' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'laugh' })).not.toBeInTheDocument();
        expect(screen.getByText(/performs no cues/)).toBeInTheDocument();
    });

    it('inserts a cue as the bracketed word the standard vocabulary uses', async () => {
        const user = setupUser();
        render(<TryPanel engine="chatterbox" defaultVariant="turbo" />);
        const line = await screen.findByRole('textbox', { name: 'Line' });
        await user.clear(line);
        await user.type(line, 'Well');

        await user.click(screen.getByRole('button', { name: 'sigh' }));

        expect(line).toHaveValue('Well[sigh]');
    });

    it('speaks what was chosen, buffered, and plays it', async () => {
        const user = setupUser();
        render(<TryPanel engine="chatterbox" defaultVariant="turbo" />);

        await user.click(await screen.findByRole('combobox', { name: 'Voice' }));
        await user.click(await screen.findByRole('option', { name: 'Narrator' }));
        await user.click(screen.getByRole('button', { name: 'Speak' }));

        await waitFor(() => expect(api.speak).toHaveBeenCalled());
        expect(api.speak.mock.calls[0]![0]).toMatchObject({
            engine: 'chatterbox',
            variant: 'turbo',
            voice: 'narrator',
            format: 'wav',
            stream: false,
        });
        expect(await screen.findByLabelText('Spoken line')).toHaveAttribute('src', 'blob:spoken');
    });

    it('shows as code the same request Speak sends', async () => {
        const user = setupUser();
        render(<TryPanel engine="chatterbox" defaultVariant="turbo" />);

        await user.click(await screen.findByRole('combobox', { name: 'Voice' }));
        await user.click(await screen.findByRole('option', { name: 'Narrator' }));
        await user.click(screen.getByRole('button', { name: 'As code' }));
        await user.click(screen.getByRole('button', { name: 'Speak' }));
        await waitFor(() => expect(api.speak).toHaveBeenCalled());

        const shown = (await screen.findByText(/curl -X POST/)).textContent!;
        const sent = JSON.stringify(api.speak.mock.calls[0]![0]);
        expect(shown).toContain(`-d '${sent}'`);
    });

    it('shows the core’s reason when a line is refused', async () => {
        const user = setupUser();
        api.speak.mockResolvedValue({ status: 404, data: { error: { code: 'unknown_voice', message: 'no voice "narrator"', retryable: false } } });
        render(<TryPanel engine="chatterbox" defaultVariant="turbo" />);

        await user.click(await screen.findByRole('button', { name: 'Speak' }));

        const alert = await screen.findByRole('alert');
        expect(within(alert).getByText('no voice "narrator"')).toBeInTheDocument();
    });
});
