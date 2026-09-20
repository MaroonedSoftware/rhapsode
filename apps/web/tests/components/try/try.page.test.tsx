import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Capabilities, CatalogEntry } from '@maroonedsoftware/rhapsode-sdk';

import { TryPanel } from '../../../src/components/try/try.panel';
import { render, screen, setupUser, waitFor, within } from '../../utils/render';

const api = vi.hoisted(() => ({
    engineCapabilities: vi.fn(),
    engineVoices: vi.fn(),
    speak: vi.fn(),
    dialogue: vi.fn(),
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

    it('offers a blend where the variant says it blends, with nothing loaded', async () => {
        // Kokoro's shape: a blend reads the voices file and never the model, so an idle engine still
        // says it blends, and the page must not wait for a load to offer it. § 4.
        api.engineCapabilities.mockResolvedValue({
            status: 200,
            data: {
                ...capabilities,
                variants: {
                    turbo: { ...capabilities.variants.turbo!, blending: { supported: true } },
                    original: { ...capabilities.variants.original!, blending: { supported: false } },
                },
            },
        });
        const user = setupUser();
        render(<TryPanel engine="chatterbox" defaultVariant="turbo" />);

        expect(await screen.findByText('Blend a voice')).toBeInTheDocument();

        await user.click(screen.getByRole('combobox', { name: 'Variant' }));
        await user.click(await screen.findByRole('option', { name: 'original' }));

        await waitFor(() => expect(screen.queryByText('Blend a voice')).not.toBeInTheDocument());
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

    it('counts the line, and says nothing about a split where the build declares none', async () => {
        render(<TryPanel engine="chatterbox" defaultVariant="turbo" />);

        await screen.findByRole('button', { name: 'laugh' });
        expect(screen.getByText(/74 characters/)).toBeInTheDocument();
        expect(screen.queryByText(/at a time/)).not.toBeInTheDocument();
    });

    it('says a long line is spoken a piece at a time, where the build declares a split', async () => {
        api.engineCapabilities.mockResolvedValue({
            status: 200,
            data: {
                ...capabilities,
                variants: {
                    ...capabilities.variants,
                    turbo: { ...capabilities.variants.turbo!, maxCharacters: 4096, segmentation: { supported: true, segmentCharacters: 50 } },
                },
            },
        });
        render(<TryPanel engine="chatterbox" defaultVariant="turbo" />);

        await screen.findByRole('button', { name: 'laugh' });
        // The sample line is 74 characters, past a 50-character piece.
        expect(screen.getByText(/74 characters of 4,096\. Spoken 50 at a time/)).toBeInTheDocument();
    });

    it('says nothing about a split for a line that fits in one generation', async () => {
        api.engineCapabilities.mockResolvedValue({
            status: 200,
            data: {
                ...capabilities,
                variants: {
                    ...capabilities.variants,
                    turbo: { ...capabilities.variants.turbo!, segmentation: { supported: true, segmentCharacters: 500 } },
                },
            },
        });
        render(<TryPanel engine="chatterbox" defaultVariant="turbo" />);

        await screen.findByRole('button', { name: 'laugh' });
        expect(screen.queryByText(/at a time/)).not.toBeInTheDocument();
    });

    it('warns before the request that a line past the ceiling is refused', async () => {
        const user = setupUser();
        api.engineCapabilities.mockResolvedValue({
            status: 200,
            data: {
                ...capabilities,
                variants: { ...capabilities.variants, turbo: { ...capabilities.variants.turbo!, maxCharacters: 80 } },
            },
        });
        render(<TryPanel engine="chatterbox" defaultVariant="turbo" />);

        const line = await screen.findByRole('textbox', { name: 'Line' });
        await user.clear(line);
        // Pasted rather than typed: `type` sends 81 keystrokes, which is slow enough to time out on
        // a loaded machine, and this test is about the length rather than about typing.
        await user.click(line);
        await user.paste('x'.repeat(81));

        const alert = await screen.findByRole('alert');
        expect(within(alert).getByText(/81 characters, and this build accepts 80/)).toBeInTheDocument();
        expect(api.speak).not.toHaveBeenCalled();
    });

    it('reads the ceiling off the resident build only when that is the chosen one', async () => {
        // `current` describes what is loaded. Its ceiling says nothing about another build, and § 4
        // is the reason the page does not guess one.
        api.engineCapabilities.mockResolvedValue({
            status: 200,
            data: {
                ...capabilities,
                current: {
                    ...capabilities.variants.original!,
                    variant: 'original',
                    maxCharacters: 300,
                    cloning: { supported: false },
                    streaming: { supported: true },
                    nativeFormat: { encoding: 'pcm_s16le', sampleRate: 24000, channels: 1 },
                },
            },
        });
        render(<TryPanel engine="chatterbox" defaultVariant="turbo" />);

        // `original` is resident, so the panel opens on it and shows its ceiling.
        expect(await screen.findByText(/74 characters of 300/)).toBeInTheDocument();
    });
});

/** Dia's document, trimmed: one build, which performs a conversation of two. */
const dia: Capabilities = {
    contract: 1,
    engine: { id: 'dia', displayName: 'Dia', adapterVersion: '0.0.0' },
    license: { code: 'Apache-2.0', weights: 'Apache-2.0', weightsCommercialUse: true },
    device: { type: 'cuda', name: 'card' },
    variants: { '1.6b': { cues: ['laugh', 'gasp'], deliveries: [], dials: {}, dialogue: { maxSpeakers: 2 } } },
    formats: ['wav'],
};

describe('TryPanel, where a variant declares dialogue', () => {
    beforeEach(() => {
        for (const mock of Object.values(api)) mock.mockReset();
        api.engineCapabilities.mockResolvedValue({ status: 200, data: dia });
        api.engineVoices.mockResolvedValue({ status: 200, data: [{ id: 'narrator', label: 'Narrator', spec: 'narrator@1.6b:ab' }] });
        api.dialogue.mockResolvedValue({ status: 200, contentType: 'audio/wav', data: new Blob([new Uint8Array(2048)], { type: 'audio/wav' }) });
        globalThis.URL.createObjectURL = vi.fn(() => 'blob:spoken');
        globalThis.URL.revokeObjectURL = vi.fn();
    });

    it('offers a conversation of as many speakers as the variant takes, and no switch elsewhere', async () => {
        render(<TryPanel engine="dia" />);
        expect(await screen.findByRole('radio', { name: 'A conversation, up to 2' })).toBeInTheDocument();

        api.engineCapabilities.mockResolvedValue({ status: 200, data: capabilities });
        render(<TryPanel engine="chatterbox" defaultVariant="turbo" />);
        await screen.findAllByRole('button', { name: 'laugh' });
        expect(screen.getAllByRole('radio', { name: /A conversation/ })).toHaveLength(1);
    });

    it('sends the turns under a label per speaker, and a voice only for a speaker who speaks', async () => {
        const user = setupUser();
        render(<TryPanel engine="dia" />);

        await user.click(await screen.findByRole('radio', { name: 'A conversation, up to 2' }));
        expect(await screen.findByRole('heading', { name: 'Conversation' })).toBeInTheDocument();
        await user.click(screen.getByRole('combobox', { name: "Speaker 1's voice" }));
        await user.click(await screen.findByRole('option', { name: 'Narrator' }));
        await user.click(screen.getByRole('button', { name: 'Speak' }));

        await waitFor(() => expect(api.dialogue).toHaveBeenCalled());
        const [engine, body] = api.dialogue.mock.calls[0]!;
        expect(engine).toBe('dia');
        expect(body).toMatchObject({
            variant: '1.6b',
            format: 'wav',
            stream: false,
            voices: { speaker1: 'narrator' },
            turns: [
                { speaker: 'speaker1', text: 'Did you hear that? [gasp]' },
                { speaker: 'speaker2', text: '[laugh] It is only the cat.' },
                { speaker: 'speaker1', text: 'It is never only the cat.' },
            ],
        });
        expect(body).not.toHaveProperty('delivery');
        expect(await screen.findByLabelText('Spoken conversation')).toBeInTheDocument();
        expect(api.speak).not.toHaveBeenCalled();
    });

    it('leaves out an empty turn, and a voice for a speaker left with none', async () => {
        const user = setupUser();
        render(<TryPanel engine="dia" />);

        await user.click(await screen.findByRole('radio', { name: 'A conversation, up to 2' }));
        await user.click(await screen.findByRole('combobox', { name: "Speaker 2's voice" }));
        await user.click(await screen.findByRole('option', { name: 'Narrator' }));
        await user.clear(screen.getByRole('textbox', { name: 'Turn 2' }));
        await user.click(screen.getByRole('button', { name: 'Speak' }));

        await waitFor(() => expect(api.dialogue).toHaveBeenCalled());
        const [, body] = api.dialogue.mock.calls[0]!;
        expect(body.turns).toHaveLength(2);
        expect(body).not.toHaveProperty('voices');
    });
});
