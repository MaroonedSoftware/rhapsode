import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpdateStatus } from '@maroonedsoftware/rhapsode-sdk';

import { CoreVersion, UpdateBanner } from '../../../src/components/update/update.banner';
import { render, screen, setupUser, waitFor } from '../../utils/render';

const { updateStatus, checkForUpdate, notifySuccess, notifyFailure } = vi.hoisted(() => ({
    updateStatus: vi.fn<() => Promise<UpdateStatus>>(),
    checkForUpdate: vi.fn<() => Promise<UpdateStatus>>(),
    notifySuccess: vi.fn(),
    notifyFailure: vi.fn(),
}));

vi.mock('../../../src/api/client', () => ({ sdk: { public: { updateStatus: () => updateStatus(), checkForUpdate: () => checkForUpdate() } } }));
vi.mock('../../../src/components/shared/notify', () => ({ notifySuccess, notifyFailure }));

const behind: UpdateStatus = {
    version: '0.1.9',
    check: 'ok',
    latest: '0.2.0',
    updateAvailable: true,
    releaseUrl: 'https://github.com/maroonedsoftware/rhapsode/releases/tag/v0.2.0',
    checkedAt: '2026-09-21T09:00:00.000Z',
    distribution: 'docker',
};

describe('UpdateBanner', () => {
    beforeEach(() => {
        updateStatus.mockReset();
        checkForUpdate.mockReset();
    });
    afterEach(() => vi.clearAllMocks());

    it('says a release is out and gives the image’s commands, both forms', async () => {
        updateStatus.mockResolvedValue(behind);
        render(<UpdateBanner />);

        expect(await screen.findByText('Rhapsode 0.2.0 is out')).toBeInTheDocument();
        expect(screen.getByText('docker compose pull && docker compose up -d')).toBeInTheDocument();
        expect(screen.getByText('RHAPSODE_VERSION')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'What changed' })).toHaveAttribute('href', behind.releaseUrl);
    });

    it('gives a checkout the checkout’s steps instead', async () => {
        updateStatus.mockResolvedValue({ ...behind, distribution: 'source' });
        render(<UpdateBanner />);

        expect(await screen.findByText('v0.2.0')).toBeInTheDocument();
        expect(screen.queryByText('docker compose pull && docker compose up -d')).not.toBeInTheDocument();
    });

    it.each<[string, UpdateStatus]>([
        ['on the latest release', { ...behind, latest: '0.1.9', updateAvailable: false }],
        ['still waiting on GitHub', { version: '0.1.9', check: 'pending', distribution: 'docker' }],
        ['unable to reach GitHub', { version: '0.1.9', check: 'failed', distribution: 'docker' }],
        ['told not to check', { version: '0.1.9', check: 'off', distribution: 'docker' }],
    ])('shows nothing when the core is %s', async (_state, status) => {
        updateStatus.mockResolvedValue(status);
        render(
            <>
                <UpdateBanner />
                <CoreVersion />
            </>,
        );

        expect(await screen.findByText('v0.1.9')).toBeInTheDocument();
        expect(screen.queryByText(/is out/)).not.toBeInTheDocument();
    });

    it('shows the core’s version in the header, from the same document', async () => {
        updateStatus.mockResolvedValue(behind);
        render(<CoreVersion />);

        expect(await screen.findByText('v0.1.9')).toBeInTheDocument();
    });

    describe('checking for updates', () => {
        const current: UpdateStatus = { ...behind, latest: '0.1.9', updateAvailable: false };
        // The header shows the button twice, a label for wide screens and an icon for phones, and
        // jsdom applies neither breakpoint, so a test takes the labelled one.
        const button = () => screen.getAllByRole('button', { name: 'Check for updates' })[0]!;

        it('asks the core now and brings up the banner when a release turns out to be out', async () => {
            const user = setupUser();
            updateStatus.mockResolvedValue(current);
            checkForUpdate.mockResolvedValue(behind);
            render(
                <>
                    <UpdateBanner />
                    <CoreVersion />
                </>,
            );

            await screen.findByText('v0.1.9');
            expect(screen.queryByText(/is out/)).not.toBeInTheDocument();
            await user.click(button());

            expect(checkForUpdate).toHaveBeenCalledTimes(1);
            expect(await screen.findByText('Rhapsode 0.2.0 is out')).toBeInTheDocument();
            expect(notifySuccess).not.toHaveBeenCalled();
        });

        it('says so when this is the latest release', async () => {
            const user = setupUser();
            updateStatus.mockResolvedValue(current);
            checkForUpdate.mockResolvedValue(current);
            render(<CoreVersion />);

            await screen.findByText('v0.1.9');
            await user.click(button());

            await waitFor(() => expect(notifySuccess).toHaveBeenCalledWith('Rhapsode 0.1.9 is the latest release.'));
        });

        it('says so when the server could not reach GitHub', async () => {
            const user = setupUser();
            updateStatus.mockResolvedValue(current);
            checkForUpdate.mockResolvedValue({ version: '0.1.9', check: 'failed', distribution: 'docker' });
            render(<CoreVersion />);

            await screen.findByText('v0.1.9');
            await user.click(button());

            await waitFor(() =>
                expect(notifyFailure).toHaveBeenCalledWith('Could not check for updates', undefined, expect.stringContaining('GitHub')),
            );
        });

        it('offers no button while the operator has turned the check off', async () => {
            updateStatus.mockResolvedValue({ version: '0.1.9', check: 'off', distribution: 'docker' });
            render(<CoreVersion />);

            expect(await screen.findByText('v0.1.9')).toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'Check for updates' })).not.toBeInTheDocument();
        });
    });
});
