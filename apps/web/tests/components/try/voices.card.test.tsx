import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Voice } from '@maroonedsoftware/rhapsode-sdk';

import { VoicesCard } from '../../../src/components/try/voices.card';
import { render, screen, setupUser, waitFor, within } from '../../utils/render';

const api = vi.hoisted(() => ({ createVoice: vi.fn(), deleteVoice: vi.fn(), engineVoices: vi.fn() }));

vi.mock('../../../src/api/client', () => ({ BASE_URL: '/api', sdk: { public: api } }));

const narrator: Voice = {
    id: 'narrator',
    label: 'Narrator',
    spec: 'narrator@turbo:ab12',
    tags: ['cloned'],
    previewUrl: '/engines/chatterbox/voices/narrator/preview',
};
const sine: Voice = { id: 'sine', label: 'Sine', spec: 'sine@plain:220', tags: ['synthetic'], previewUrl: '/engines/tone/voices/sine/preview' };

/** Mantine's FileInput labels its button; the file input it drives is hidden and unlabelled. */
const fileInput = () => document.querySelector<HTMLInputElement>('input[type=file]')!;

const clip = (bytes = 1024) => new File([new Uint8Array(bytes)], 'clip.wav', { type: 'audio/wav' });

describe('VoicesCard', () => {
    beforeEach(() => {
        for (const mock of Object.values(api)) mock.mockReset();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('says so when there are no voices, rather than showing nothing', () => {
        render(<VoicesCard engine="chatterbox" voices={[]} onCloned={() => {}} />);
        expect(screen.getByText(/no voices yet/)).toBeInTheDocument();
    });

    it('offers no clone form when the variant says it cannot clone', () => {
        render(<VoicesCard engine="orpheus" voices={[]} cloning={{ supported: false }} onCloned={() => {}} />);
        expect(screen.queryByText('Clone a voice')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Clone' })).not.toBeInTheDocument();
        expect(screen.queryByText(/Clone one from a clip/)).not.toBeInTheDocument();
    });

    it('offers the clone form when nothing says whether the variant clones', () => {
        // A worker from before § 4 put `cloning` on variants: the worker refuses what it cannot make.
        render(<VoicesCard engine="chatterbox" voices={[]} onCloned={() => {}} />);
        expect(screen.getByRole('button', { name: 'Clone' })).toBeInTheDocument();
    });

    it('asks for the reference length the variant claims', () => {
        render(<VoicesCard engine="chatterbox" voices={[]} cloning={{ supported: true, referenceSeconds: [5, 10] }} onCloned={() => {}} />);
        expect(screen.getByText(/5 to 10 seconds/)).toBeInTheDocument();
    });

    it('plays a preview from the URL the core gave, keyed on the spec', async () => {
        const user = setupUser();
        render(<VoicesCard engine="chatterbox" voices={[narrator]} onCloned={() => {}} />);

        await user.click(screen.getByRole('button', { name: 'Preview Narrator' }));

        expect(screen.getByLabelText('Preview of Narrator')).toHaveAttribute(
            'src',
            '/api/engines/chatterbox/voices/narrator/preview?spec=narrator%40turbo%3Aab12',
        );
    });

    it('offers delete for a clone and not for a built-in voice', () => {
        render(<VoicesCard engine="tone" voices={[narrator, sine]} onCloned={() => {}} />);
        expect(screen.getByRole('button', { name: 'Delete Narrator' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Delete Sine' })).not.toBeInTheDocument();
    });

    it('uploads the clip with its id and label, and hands the new id back', async () => {
        const user = setupUser();
        const onCloned = vi.fn();
        api.createVoice.mockResolvedValue({ status: 201, data: { id: 'announcer', label: 'The Announcer', spec: 'announcer@turbo:cd34' } });
        render(<VoicesCard engine="chatterbox" voices={[]} onCloned={onCloned} />);

        await user.upload(fileInput(), clip());
        await user.type(screen.getByRole('textbox', { name: 'Id' }), 'announcer');
        await user.type(screen.getByRole('textbox', { name: 'Label' }), 'The Announcer');
        await user.click(screen.getByRole('button', { name: 'Clone' }));

        await waitFor(() => expect(onCloned).toHaveBeenCalledWith('announcer'));
        const [engine, form] = api.createVoice.mock.calls[0]! as [string, FormData];
        expect(engine).toBe('chatterbox');
        expect(form.get('id')).toBe('announcer');
        expect(form.get('label')).toBe('The Announcer');
        expect((form.get('reference') as File).name).toBe('clip.wav');
    });

    it('refuses an id the server would refuse, before uploading anything', async () => {
        const user = setupUser();
        render(<VoicesCard engine="chatterbox" voices={[]} onCloned={() => {}} />);

        await user.upload(fileInput(), clip());
        await user.type(screen.getByRole('textbox', { name: 'Id' }), '../x');

        expect(screen.getByText(/starting with a letter or digit/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Clone' })).toBeDisabled();
    });

    it('shows the core’s reason when a clone is refused', async () => {
        const user = setupUser();
        api.createVoice.mockResolvedValue({
            status: 403,
            data: { error: { code: 'forbidden', message: 'management routes answer loopback callers', retryable: false } },
        });
        render(<VoicesCard engine="chatterbox" voices={[]} onCloned={() => {}} />);

        await user.upload(fileInput(), clip());
        await user.type(screen.getByRole('textbox', { name: 'Id' }), 'announcer');
        await user.click(screen.getByRole('button', { name: 'Clone' }));

        const alert = await screen.findByRole('alert');
        expect(within(alert).getByText('management routes answer loopback callers')).toBeInTheDocument();
    });

    it('offers delete for a blend and an uploaded voice, which were made here too', () => {
        const blended: Voice = { id: 'host', label: 'Host', spec: 'host@a1-fp16', tags: ['en', 'en-us', 'blended'] };
        const uploaded: Voice = { id: 'gurney', label: 'Gurney', spec: 'gurney@b2-fp16', tags: ['en', 'en-us', 'uploaded'] };
        render(<VoicesCard engine="kokoro" voices={[blended, uploaded]} onCloned={() => {}} />);
        expect(screen.getByRole('button', { name: 'Delete Host' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Delete Gurney' })).toBeInTheDocument();
        expect(screen.getByText('blended')).toBeInTheDocument();
    });

    it('asks for the files the engine declares, and does not call a style vector a recording', () => {
        render(<VoicesCard engine="kokoro" voices={[]} cloning={{ supported: true, formats: ['npy', 'pt'] }} onCloned={() => {}} />);
        expect(screen.getByText('Add a voice from a file')).toBeInTheDocument();
        expect(screen.getByText(/not a recording: NPY, PT/)).toBeInTheDocument();
        expect(fileInput()).toHaveAttribute('accept', '.npy,.pt');
        expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
        expect(screen.queryByText(/seconds of one person speaking/)).not.toBeInTheDocument();
    });

    it('offers no file form to an engine that says it makes no voices from one', () => {
        render(<VoicesCard engine="tone" voices={[sine]} cloning={{ supported: false }} onCloned={() => {}} />);
        expect(screen.queryByRole('button', { name: 'Clone' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument();
    });

    it('offers a blend only where the engine says it blends', () => {
        render(<VoicesCard engine="chatterbox" voices={[narrator]} onCloned={() => {}} />);
        expect(screen.queryByText('Blend a voice')).not.toBeInTheDocument();
    });

    it('sends a blend as its recipe with the id and label, and hands the new id back', async () => {
        const user = setupUser();
        const onCloned = vi.fn();
        api.createVoice.mockResolvedValue({ status: 201, data: { id: 'host', label: 'Host', spec: 'host@a1-fp16' } });
        render(<VoicesCard engine="kokoro" voices={[]} cloning={{ supported: false }} blending onCloned={onCloned} />);

        await user.type(screen.getByRole('textbox', { name: 'Recipe' }), 'af_bella(2)+af_sky(1)');
        await user.type(screen.getByRole('textbox', { name: 'Id' }), 'host');
        await user.type(screen.getByRole('textbox', { name: 'Label' }), 'Host');
        await user.click(screen.getByRole('button', { name: 'Blend' }));

        await waitFor(() => expect(onCloned).toHaveBeenCalledWith('host'));
        const [engine, form] = api.createVoice.mock.calls[0]! as [string, FormData];
        expect(engine).toBe('kokoro');
        expect(form.get('blend')).toBe('af_bella(2)+af_sky(1)');
        expect(form.get('id')).toBe('host');
        expect(form.get('label')).toBe('Host');
        expect(form.get('reference')).toBeNull();
    });

    it('shows the core’s reason when a blend is refused', async () => {
        const user = setupUser();
        api.createVoice.mockResolvedValue({
            status: 404,
            data: { error: { code: 'unknown_voice', message: 'no voice "nobody"', retryable: false } },
        });
        render(<VoicesCard engine="kokoro" voices={[]} cloning={{ supported: false }} blending onCloned={() => {}} />);

        await user.type(screen.getByRole('textbox', { name: 'Recipe' }), 'af_bella+nobody');
        await user.type(screen.getByRole('textbox', { name: 'Id' }), 'host');
        await user.click(screen.getByRole('button', { name: 'Blend' }));

        const alert = await screen.findByRole('alert');
        expect(within(alert).getByText('no voice "nobody"')).toBeInTheDocument();
    });
});
