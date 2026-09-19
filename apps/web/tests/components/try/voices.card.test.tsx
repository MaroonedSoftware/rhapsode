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
        expect(form.has('transcript')).toBe(false);
    });

    it('sends the words spoken in the clip when they are given', async () => {
        const user = setupUser();
        api.createVoice.mockResolvedValue({ status: 201, data: { id: 'announcer', label: 'Announcer', spec: 'announcer@1.6b:ab12' } });
        render(<VoicesCard engine="dia" voices={[]} onCloned={() => {}} />);

        await user.upload(fileInput(), clip());
        await user.type(screen.getByRole('textbox', { name: 'Id' }), 'announcer');
        await user.type(screen.getByRole('textbox', { name: /Transcript/ }), '  Hello, this is how I sound.  ');
        await user.click(screen.getByRole('button', { name: 'Clone' }));

        await waitFor(() => expect(api.createVoice).toHaveBeenCalled());
        const [, form] = api.createVoice.mock.calls[0]! as [string, FormData];
        expect(form.get('transcript')).toBe('Hello, this is how I sound.');
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
});
