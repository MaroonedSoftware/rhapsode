import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Settings, SettingsPatch } from '@maroonedsoftware/rhapsode-sdk';

import { SettingsPage } from '../../../src/components/settings/settings.page';
import { render, screen, setupUser, waitFor, within } from '../../utils/render';

type Answer = { status: number; data: unknown };

const { settings, updateSettings } = vi.hoisted(() => ({
    settings: vi.fn<() => Promise<Answer>>(),
    updateSettings: vi.fn<(patch: SettingsPatch) => Promise<Answer>>(),
}));

vi.mock('../../../src/api/client', () => ({
    sdk: {
        public: {
            settings: () => settings(),
            updateSettings: (patch: SettingsPatch) => updateSettings(patch),
            residency: () => Promise.resolve({ resident: 0, max: 1, waiting: 0, models: [] }),
        },
    },
}));

const document = (): Settings => ({
    values: {
        server: { port: 8080, host: '::', shutdownGraceMs: 20000 },
        log: { level: 'info' },
        residency: { maxResidentModels: 1, evictionWaitSeconds: 30, keepAliveSeconds: 300 },
        workers: {
            socketDir: '/run/rhapsode',
            voiceDir: '/config/voices',
            startupTimeoutSeconds: 60,
            drainGraceMs: 10000,
            maxRestarts: 5,
            restartDecaySeconds: 300,
        },
        install: { venvDir: '/data/venvs', sourceDir: '/app/python', python: '3.12' },
        management: { tokenSet: true, origins: [] },
        update: { check: true },
        engines: { kokoro: { keepAliveSeconds: 900 } },
    },
    fields: [
        { key: 'server.port', source: 'config', applies: 'restart' },
        { key: 'server.host', source: 'default', applies: 'restart' },
        { key: 'server.shutdownGraceMs', source: 'default', applies: 'restart' },
        { key: 'log.level', source: 'default', applies: 'restart' },
        { key: 'residency.maxResidentModels', source: 'default', applies: 'live' },
        { key: 'residency.evictionWaitSeconds', source: 'default', applies: 'live' },
        { key: 'residency.keepAliveSeconds', source: 'default', applies: 'live' },
        { key: 'workers.socketDir', source: 'default', applies: 'restart' },
        { key: 'workers.voiceDir', source: 'config', applies: 'restart' },
        { key: 'workers.startupTimeoutSeconds', source: 'default', applies: 'restart' },
        { key: 'workers.drainGraceMs', source: 'default', applies: 'restart' },
        { key: 'workers.maxRestarts', source: 'default', applies: 'restart' },
        { key: 'workers.restartDecaySeconds', source: 'default', applies: 'restart' },
        { key: 'install.venvDir', source: 'default', applies: 'restart' },
        { key: 'install.sourceDir', source: 'config', applies: 'restart' },
        { key: 'install.python', source: 'config', applies: 'restart' },
        { key: 'management.token', source: 'config', applies: 'restart' },
        { key: 'management.origins', source: 'default', applies: 'restart' },
        { key: 'update.check', source: 'default', applies: 'live' },
        { key: 'engines.kokoro.keepAliveSeconds', source: 'database', applies: 'live' },
    ],
});

const ok = (data: Settings): Answer => ({ status: 200, data });

/** The card a heading names, so a test acts on one group and not on a field of the same name elsewhere. */
const card = async (title: string) => (await screen.findByRole('heading', { name: title })).closest('.mantine-Card-root') as HTMLElement;

describe('SettingsPage', () => {
    beforeEach(() => {
        settings.mockReset();
        updateSettings.mockReset();
    });
    afterEach(() => vi.clearAllMocks());

    it('shows each setting with where its value came from and when a change applies', async () => {
        settings.mockResolvedValue(ok(document()));
        render(<SettingsPage />);

        const server = await card('Server');
        expect(within(server).getByLabelText('Port')).toHaveValue('8080');
        expect(within(server).getAllByText('From rhapsode.config.json').length).toBeGreaterThan(0);
        expect(within(server).getAllByText('Applies at restart').length).toBe(4);

        const memory = await card('Memory on the card');
        expect(within(memory).getByLabelText('kokoro (seconds)')).toHaveValue('900');
        expect(within(memory).getByText('Set here')).toBeInTheDocument();
        expect(within(memory).queryByText('Applies at restart')).not.toBeInTheDocument();
    });

    it('saves only what was changed in a card, so nothing else becomes "set here"', async () => {
        settings.mockResolvedValue(ok(document()));
        updateSettings.mockResolvedValue(ok(document()));
        const user = setupUser();
        render(<SettingsPage />);

        const memory = await card('Memory on the card');
        const keepAlive = within(memory).getByLabelText('Keep a model loaded for (seconds)');
        await user.clear(keepAlive);
        await user.type(keepAlive, '900');
        await user.click(within(memory).getByRole('button', { name: 'Save memory on the card' }));

        await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ residency: { keepAliveSeconds: 900 } }));
        // Saved, so the draft is gone and there is nothing left to save.
        await waitFor(() => expect(within(memory).getByRole('button', { name: 'Save memory on the card' })).toBeDisabled());
    });

    it('clears a setting set here with Reset, back to the file or the default', async () => {
        settings.mockResolvedValue(ok(document()));
        updateSettings.mockResolvedValue(ok(document()));
        const user = setupUser();
        render(<SettingsPage />);

        await user.click(within(await card('Memory on the card')).getByRole('button', { name: 'Reset' }));

        await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ engines: { kokoro: { keepAliveSeconds: null } } }));
    });

    it('lists the changes waiting for a restart, the token among them without its value', async () => {
        const waiting = document();
        waiting.fields = waiting.fields.map(field =>
            field.key === 'server.port'
                ? { ...field, source: 'database', saved: 9100 }
                : field.key === 'management.token'
                  ? { ...field, source: 'database', saved: true }
                  : field,
        );
        settings.mockResolvedValue(ok(waiting));
        render(<SettingsPage />);

        const alert = (await screen.findByText('2 changes waiting for a restart')).closest('.mantine-Alert-root') as HTMLElement;
        expect(within(alert).getByText('Port')).toBeInTheDocument();
        expect(within(alert).getByText('Management token')).toBeInTheDocument();
        expect(screen.getByText('9100 after a restart')).toBeInTheDocument();
        expect(screen.getByText('New token waiting for a restart')).toBeInTheDocument();
    });

    it('sends a new token, and only once somebody has typed or generated one', async () => {
        settings.mockResolvedValue(ok(document()));
        updateSettings.mockResolvedValue(ok(document()));
        const user = setupUser();
        render(<SettingsPage />);

        const access = await card('Access');
        const save = within(access).getByRole('button', { name: 'Save access' });
        expect(save).toBeDisabled();

        await user.type(within(access).getByLabelText('New management token'), 'n3w-token');
        await user.click(save);

        await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ management: { token: 'n3w-token' } }));
    });

    it('asks before removing the token, and sends it empty, which is none', async () => {
        settings.mockResolvedValue(ok(document()));
        updateSettings.mockResolvedValue(ok(document()));
        const user = setupUser();
        render(<SettingsPage />);

        await user.click(within(await card('Access')).getByRole('button', { name: 'Remove the token' }));
        expect(updateSettings).not.toHaveBeenCalled();
        await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove the token' }));

        await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ management: { token: '' } }));
    });

    it('shows a refusal in the card whose change it refused, in the core’s words', async () => {
        settings.mockResolvedValue(ok(document()));
        updateSettings.mockResolvedValue({
            status: 409,
            data: { error: { code: 'conflict', message: 'management.origins would no longer list http://tower:8081', retryable: false } },
        });
        const user = setupUser();
        render(<SettingsPage />);

        const access = await card('Access');
        await user.type(within(access).getByPlaceholderText('Type one and press Enter'), 'http://nas:8081{enter}');
        await user.click(within(access).getByRole('button', { name: 'Save access' }));

        expect(await within(access).findByText('Nothing was saved')).toBeInTheDocument();
        expect(within(access).getByText('management.origins would no longer list http://tower:8081')).toBeInTheDocument();
        expect(updateSettings).toHaveBeenCalledWith({ management: { origins: ['http://nas:8081'] } });
    });

    it('says why a page from another machine cannot see settings, and shows no form', async () => {
        settings.mockResolvedValue({
            status: 403,
            data: { error: { code: 'forbidden', message: 'management routes answer this machine, or a caller with the token', retryable: false } },
        });
        render(<SettingsPage />);

        expect(await screen.findByText('Settings are only for the machine running rhapsode')).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'Server' })).not.toBeInTheDocument();
    });
});
